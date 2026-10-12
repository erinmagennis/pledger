import { createHash } from 'node:crypto';
import { dkimVerify } from 'mailauth/lib/dkim/verify.js';
import PostalMime from 'postal-mime';
import { createPublicResolver, type DnsResolver } from './dns.js';
import { classifySubject, htmlToText, normalizeText, parseReceiptBody, parseSoldBody } from './parse.js';

export { createPublicResolver } from './dns.js';
export type { DnsResolver } from './dns.js';
export { pairSelfBacked } from './pair.js';
export type { PairedReceipt, PairResult } from './pair.js';

/** The only DKIM signing domain (d=) and From domain we trust. */
export const ARTIZEN_DOMAIN = 'artizen.fund';

/** Season 7 window, inclusive, UTC. Change here for a new season. */
export const SEASON = {
  start: '2026-07-01T00:00:00.000Z',
  end: '2026-10-31T23:59:59.999Z',
};

export const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Headers whose values we trust; each must be covered by the artizen.fund signature.
 * Message-ID is NOT in Artizen's real h= list, so it is informational only and is kept
 * out of the fingerprint (see below).
 */
const REQUIRED_SIGNED = ['from', 'to', 'subject', 'date'];
const SINGLETON_HEADERS = ['from', 'to', 'subject', 'date', 'message-id'];

export interface Result {
  ok: boolean;
  reason?: string;
  kind?: 'receipt' | 'sold' | 'other';
  fingerprint?: string;
  messageId?: string;
  date?: string;
  to?: string;
  project?: string;
  artifacts?: number;
  contribution?: number;
  endowmentFee?: number;
  totalCost?: number;
  buyerName?: string;
  matchUnlocked?: number;
}

export interface VerifyOptions {
  /** DNS resolver in mailauth's (name, rrtype) shape. Defaults to public DNS (8.8.8.8 / 1.1.1.1). */
  resolver?: DnsResolver;
  /** Override the season window (ISO strings, inclusive). */
  season?: { start: string; end: string };
}

let defaultResolver: DnsResolver | undefined;

/** Unfold and collect raw header fields (lowercased key, unfolded value), in order. */
function readHeaders(head: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const line of head.split('\r\n')) {
    if (/^[ \t]/.test(line) && out.length) {
      out[out.length - 1].value += ' ' + line.trim();
      continue;
    }
    const i = line.indexOf(':');
    if (i <= 0) return [];
    const key = line.slice(0, i).trim().toLowerCase();
    if (!/^[\x21-\x39\x3b-\x7e]+$/.test(key)) return [];
    out.push({ key, value: line.slice(i + 1).trim() });
  }
  return out;
}

function addrDomain(addr: string): string {
  const at = addr.lastIndexOf('@');
  return at < 0 ? '' : addr.slice(at + 1).toLowerCase().replace(/\.$/, '');
}

const fail = (reason: string, extra: Partial<Result> = {}): Result => ({ ok: false, reason, ...extra });

export async function verifyArtizenEmail(raw: Buffer, opts: VerifyOptions = {}): Promise<Result> {
  if (!Buffer.isBuffer(raw)) return fail('not-a-buffer');
  if (raw.length > MAX_BYTES) return fail('too-large');
  if (raw.length === 0) return fail('not-rfc822');

  // Canonical line endings: CRLF everywhere, no leading blank lines. DKIM's relaxed/simple
  // body canonicalization already ignores trailing empty lines.
  const text = raw.toString('latin1').replace(/\r?\n/g, '\r\n').replace(/^(\r\n)+/, '');
  const sep = text.indexOf('\r\n\r\n');
  if (sep <= 0) return fail('not-rfc822');
  const headers = readHeaders(text.slice(0, sep));
  if (!headers.length) return fail('not-rfc822');
  const has = (k: string) => headers.filter((h) => h.key === k).length;
  if (!has('from') || !has('date') || !has('subject')) return fail('not-rfc822');
  for (const k of SINGLETON_HEADERS) {
    if (has(k) > 1) return fail(`duplicate-header:${k}`);
  }
  if (!has('message-id')) return fail('no-message-id');
  if (!has('to')) return fail('no-to');
  const canonical = Buffer.from(text, 'latin1');

  // ---- DKIM ----
  const resolver = opts.resolver ?? (defaultResolver ??= createPublicResolver());
  let dkim: any;
  try {
    dkim = await dkimVerify(canonical, { resolver });
  } catch (err: any) {
    return fail('dkim-error');
  }
  if (dkim.fromFields !== 1 || !Array.isArray(dkim.headerFrom) || dkim.headerFrom.length !== 1) {
    return fail('bad-from');
  }
  const fromDomain = addrDomain(dkim.headerFrom[0]);
  if (fromDomain !== ARTIZEN_DOMAIN) return fail('from-not-artizen');

  const results: any[] = dkim.results || [];
  const artizenSigs = results.filter((r) => (r.signingDomain || '').toLowerCase() === ARTIZEN_DOMAIN);
  if (!artizenSigs.length) return fail('no-artizen-signature');
  const passing = artizenSigs.find((r) => r.status?.result === 'pass');
  if (!passing) {
    const st = artizenSigs[0].status?.result || 'unknown';
    return fail(`dkim-${st}`);
  }
  if (passing.canonBodyLengthLimited) return fail('dkim-partial-body');
  const signed = String(passing.signingHeaders?.keys || '')
    .split(':')
    .map((k: string) => k.trim().toLowerCase())
    .filter(Boolean);
  for (const k of REQUIRED_SIGNED) {
    if (!signed.includes(k)) return fail(`unsigned-header:${k}`);
  }
  // Canonical b=: decode and re-encode, so whitespace or non-canonical base64 tail bits
  // (which decoders ignore and DKIM still passes) cannot produce a second fingerprint.
  const bBytes = Buffer.from(String(passing.signature || '').replace(/\s+/g, ''), 'base64');
  if (!bBytes.length) return fail('dkim-no-signature-value');
  const bValue = bBytes.toString('base64');

  // ---- Parse ----
  let email: any;
  try {
    email = await PostalMime.parse(canonical);
  } catch {
    return fail('not-rfc822');
  }
  const messageId = String(headers.find((h) => h.key === 'message-id')!.value).trim();
  // Fingerprint = sha256(`${signedMessageId}|${b}`). signedMessageId is the Message-ID only
  // when the artizen.fund signature covers it, else ''. An unsigned Message-ID can be edited
  // freely, which would let one receipt yield many fingerprints (double claims). b= alone
  // already commits to body + signed headers, so it is unique per email.
  const messageIdSigned = signed.includes('message-id');
  const fingerprint = createHash('sha256')
    .update(`${messageIdSigned ? messageId : ''}|${bValue}`)
    .digest('hex');
  const dateRaw = headers.find((h) => h.key === 'date')!.value;
  const dateMs = Date.parse(dateRaw);
  if (!Number.isFinite(dateMs)) return fail('bad-date', { fingerprint, messageId });
  const date = new Date(dateMs).toISOString();
  const toAddrs: string[] = (email.to || []).flatMap((a: any) => (a.group ? a.group : [a])).map((a: any) => a.address).filter(Boolean);
  if (toAddrs.length !== 1) return fail('bad-to', { fingerprint, messageId, date });
  const to = String(toAddrs[0]).trim().toLowerCase();

  const base: Result = { ok: false, fingerprint, messageId, date, to };
  const subject = String(email.subject || '');
  const cls = classifySubject(subject);
  base.kind = cls.kind;
  if (cls.kind === 'other') return { ...base, reason: 'not-a-receipt' };

  const season = opts.season ?? SEASON;
  if (dateMs < Date.parse(season.start) || dateMs > Date.parse(season.end)) {
    return { ...base, reason: 'outside-season' };
  }

  const bodyText = email.html ? htmlToText(email.html) : normalizeText(email.text || '');
  if (!bodyText) return { ...base, reason: 'empty-body' };

  if (cls.kind === 'receipt') {
    if (!cls.project || !cls.artifacts) return { ...base, reason: 'bad-subject' };
    const f = parseReceiptBody(bodyText);
    const out: Result = { ...base, project: cls.project, artifacts: cls.artifacts, ...f };
    if (f.contribution === undefined) return { ...out, reason: 'no-contribution-line' };
    if (f.endowmentFee === undefined) return { ...out, reason: 'no-fee-line' };
    return { ...out, ok: true };
  }

  // sold
  const s = parseSoldBody(bodyText);
  if (s.contribution === undefined || !s.buyerName) return { ...base, reason: 'no-sale-line' };
  return {
    ...base,
    ok: true,
    project: cls.project ?? s.project,
    artifacts: cls.artifacts ?? s.artifacts,
    contribution: s.contribution,
    buyerName: s.buyerName,
    ...(s.matchUnlocked !== undefined ? { matchUnlocked: s.matchUnlocked } : {}),
  };
}
