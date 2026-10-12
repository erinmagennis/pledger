import { generateKeyPairSync } from 'node:crypto';
import { dkimSign } from 'mailauth/lib/dkim/sign.js';
import type { DnsResolver } from '../src/dns.js';

/** Locally generated test keys. The stub resolver below is the only place they are "published". */
function makeKey() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

export const KEYS = {
  artizen: makeKey(),
  sendgrid: makeKey(),
};

const DNS: Record<string, string> = {
  's1._domainkey.artizen.fund': `v=DKIM1; k=rsa; p=${KEYS.artizen.publicB64}`,
  'smtpapi._domainkey.sendgrid.info': `v=DKIM1; k=rsa; p=${KEYS.sendgrid.publicB64}`,
};

/** Resolver stub: answers only for the test selectors, NXDOMAIN otherwise. */
export const stubResolver: DnsResolver = async (name, rrtype) => {
  const rec = rrtype.toUpperCase() === 'TXT' ? DNS[name.toLowerCase()] : undefined;
  if (!rec) {
    const e: any = new Error(`ENOTFOUND ${name}`);
    e.code = 'ENOTFOUND';
    throw e;
  }
  return [[rec]];
};

export interface MsgSpec {
  from?: string;
  to?: string;
  subject: string;
  date?: string;
  messageId?: string;
  html?: string;
  text?: string;
  /** Use quoted-printable for the body part. */
  qp?: boolean;
}

function qpEncode(s: string): string {
  const bytes = Buffer.from(s, 'utf8');
  let out = '';
  let line = '';
  for (const b of bytes) {
    let tok: string;
    if (b === 0x0a) {
      out += line + '\r\n';
      line = '';
      continue;
    }
    if (b === 0x0d) continue;
    if ((b >= 33 && b <= 126 && b !== 61) || b === 32) tok = String.fromCharCode(b);
    else tok = '=' + b.toString(16).toUpperCase().padStart(2, '0');
    if (line.length + tok.length > 72) {
      out += line + '=\r\n';
      line = '';
    }
    line += tok;
  }
  return out + line;
}

export function buildMessage(m: MsgSpec): string {
  const isHtml = m.html !== undefined;
  const body = (isHtml ? m.html : m.text) ?? '';
  const encoded = m.qp ? qpEncode(body) : Buffer.from(body, 'utf8').toString('latin1').replace(/\r?\n/g, '\r\n');
  const headers = [
    `Content-Transfer-Encoding: ${m.qp ? 'quoted-printable' : '8bit'}`,
    `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
    `Date: ${m.date ?? 'Sat, 15 Aug 2026 14:03:11 +0000'}`,
    `From: ${m.from ?? 'Artizen <hello@artizen.fund>'}`,
    'Mime-Version: 1.0',
    `Message-ID: ${m.messageId ?? '<test-msg-1@artizen.fund>'}`,
    `Subject: ${m.subject}`,
    `To: ${m.to ?? 'Collector@Example.test'}`,
  ];
  return headers.join('\r\n') + '\r\n\r\n' + encoded + '\r\n';
}

/** Mirrors Artizen's real h= list shape: Message-ID is NOT signed. */
export const SIGNED_HEADERS = 'content-transfer-encoding:content-type:date:from:mime-version:subject:to';

export async function sign(
  msg: string,
  domains: Array<'artizen.fund' | 'sendgrid.info'>,
  headerList: string = SIGNED_HEADERS,
): Promise<string> {
  const signatureData = domains.map((d) => ({
    signingDomain: d,
    selector: d === 'artizen.fund' ? 's1' : 'smtpapi',
    privateKey: d === 'artizen.fund' ? KEYS.artizen.privatePem : KEYS.sendgrid.privatePem,
  }));
  const res: any = await dkimSign(Buffer.from(msg, 'latin1'), {
    canonicalization: 'relaxed/relaxed',
    algorithm: 'rsa-sha256',
    headerList,
    signatureData,
  });
  if (res.errors?.length) throw new Error('sign failed: ' + JSON.stringify(res.errors));
  return res.signatures + msg;
}

export const RECEIPT_HTML = `<html><head><style>p{color:red}</style></head><body>
<table><tr><td><h1>Thank you!</h1></td></tr>
<tr><td>You collected 5 Artifacts from Purses</td></tr>
<tr><td>Contribution - $750</td></tr>
<tr><td>Endowment fee&ndash; $75.00</td></tr>
<tr><td><b>TOTAL COST</b></td><td>$825.00</td></tr>
</table></body></html>`;

export const SOLD_HTML = `<html><body><p>Great news!</p>
<p>Erin just collected 75 Artifacts from your project Purses . You earned $750 from the sale and unlocked $2,250 in match funding.</p>
</body></html>`;

export function receiptSpec(over: Partial<MsgSpec> = {}): MsgSpec {
  return { subject: 'You collected 5 Artifacts from Purses', html: RECEIPT_HTML, ...over };
}

export function soldSpec(over: Partial<MsgSpec> = {}): MsgSpec {
  return { subject: 'You sold 75 Artifacts for Purses', html: SOLD_HTML, messageId: '<test-sold-1@artizen.fund>', ...over };
}
