// GENERATED from verify/src by app/scripts/sync-verify.mjs. Do not edit here.
/** Body/subject parsing for Artizen receipt ("You collected") and sale ("You sold") emails. */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hyphen: '-', minus: '-', dash: '-',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®',
  trade: '™', euro: '€', dollar: '$', zwnj: '', zwj: '', shy: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      return String.fromCodePoint(code);
    }
    const v = NAMED_ENTITIES[body.toLowerCase()];
    return v === undefined ? m : v;
  });
}

export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|td|th)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  return normalizeText(s);
}

/** Collapse whitespace (incl. nbsp, zero-width chars), unify dash variants to '-'. */
export function normalizeText(s: string): string {
  return s
    .replace(/[​-‍⁠﻿­]/g, '')
    .replace(/[  -   　\t\f\v]/g, ' ')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/\r\n?/g, '\n')
    .replace(/ +/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function parseMoney(s: string): number {
  return Number(s.replace(/,/g, ''));
}

const SEP = String.raw`\s*[-:]?\s*`; // after normalizeText all dash variants are '-'
const MONEY = String.raw`\$\s*([\d,]+(?:\.\d{1,2})?)`;

export type Kind = 'receipt' | 'sold' | 'other';

export function classifySubject(subject: string): { kind: Kind; artifacts?: number; project?: string } {
  const s = normalizeText(subject).replace(/\n/g, ' ');
  let m = s.match(/^You collected\s+([\d,]+)\s+Artifacts?\s+from\s+(.+?)\s*$/i);
  if (m) return { kind: 'receipt', artifacts: parseMoney(m[1]), project: m[2].trim() };
  if (/^You collected\b/i.test(s)) return { kind: 'receipt' };
  m = s.match(/^You sold\s+([\d,]+)\s+Artifacts?\s+for\s+(.+?)\s*$/i);
  if (m) return { kind: 'sold', artifacts: parseMoney(m[1]), project: m[2].trim() };
  return { kind: 'other' };
}

export interface ReceiptFields {
  contribution?: number;
  endowmentFee?: number;
  totalCost?: number;
}

export function parseReceiptBody(text: string): ReceiptFields {
  const t = normalizeText(text);
  const out: ReceiptFields = {};
  const c = t.match(new RegExp(String.raw`Contribution${SEP}${MONEY}`, 'i'));
  if (c) out.contribution = parseMoney(c[1]);
  const f = t.match(new RegExp(String.raw`Endowment\s*fee${SEP}${MONEY}`, 'i'));
  if (f) out.endowmentFee = parseMoney(f[1]);
  const tc = t.match(new RegExp(String.raw`TOTAL\s*COST${SEP}${MONEY}`, 'i'));
  if (tc) out.totalCost = parseMoney(tc[1]);
  return out;
}

export interface SoldFields {
  buyerName?: string;
  project?: string;
  artifacts?: number;
  contribution?: number;
  matchUnlocked?: number;
}

export function parseSoldBody(text: string): SoldFields {
  // Buyer name may not span lines; the rest of the sentence may (\s matches \n).
  const t = normalizeText(text);
  const m = t.match(
    new RegExp(
      String.raw`([^.!?:;\n]{1,80}?)\s+just collected\s+([\d,]+)\s+Artifacts?\s+from your project\s+(.+?)\s*\.\s*You earned\s+${MONEY}\s+from the sale(?:\s*,?\s*and unlocked\s+${MONEY}\s+in match funding)?`,
      'i',
    ),
  );
  if (!m) return {};
  const out: SoldFields = {
    buyerName: m[1].trim(),
    artifacts: parseMoney(m[2]),
    project: m[3].replace(/\s+/g, ' ').trim(),
    contribution: parseMoney(m[4]),
  };
  if (m[5]) out.matchUnlocked = parseMoney(m[5]);
  return out;
}
