import { describe, expect, it } from 'vitest';
import { verifyArtizenEmail, pairSelfBacked, type Result } from '../src/index.js';
import { parseReceiptBody, htmlToText, classifySubject, parseSoldBody } from '../src/parse.js';
import { buildMessage, receiptSpec, sign, SIGNED_HEADERS, soldSpec, stubResolver } from './fixtures.js';

const opts = { resolver: stubResolver };
const verify = (s: string | Buffer) => verifyArtizenEmail(Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1'), opts);

describe('DKIM', () => {
  it('accepts a valid artizen.fund signature and parses a receipt', async () => {
    const eml = await sign(buildMessage(receiptSpec()), ['artizen.fund', 'sendgrid.info']);
    const r = await verify(eml);
    expect(r.reason).toBeUndefined();
    expect(r).toMatchObject({
      ok: true,
      kind: 'receipt',
      project: 'Purses',
      artifacts: 5,
      contribution: 750,
      endowmentFee: 75,
      totalCost: 825,
      to: 'collector@example.test',
      messageId: '<test-msg-1@artizen.fund>',
      date: '2026-08-15T14:03:11.000Z',
    });
    expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects when only sendgrid.info signed (even if valid)', async () => {
    const eml = await sign(buildMessage(receiptSpec()), ['sendgrid.info']);
    const r = await verify(eml);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-artizen-signature');
  });

  it('rejects when From is not artizen.fund even with an artizen.fund signature', async () => {
    const eml = await sign(buildMessage(receiptSpec({ from: 'Artizen <hello@artizen.fund.evil.test>' })), ['artizen.fund']);
    const r = await verify(eml);
    expect(r).toMatchObject({ ok: false, reason: 'from-not-artizen' });
  });

  it('rejects a tampered body', async () => {
    const eml = await sign(buildMessage(receiptSpec()), ['artizen.fund', 'sendgrid.info']);
    const tampered = eml.replace('Contribution - $750', 'Contribution - $7500');
    expect(tampered).not.toBe(eml);
    const r = await verify(tampered);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^dkim-(fail|neutral)/);
  });

  it('rejects a tampered To header', async () => {
    const eml = await sign(buildMessage(receiptSpec()), ['artizen.fund']);
    const tampered = eml.replace('To: Collector@Example.test', 'To: attacker@example.test');
    expect(tampered).not.toBe(eml);
    const r = await verify(tampered);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^dkim-/);
  });

  it('rejects a prepended duplicate To header', async () => {
    const eml = await sign(buildMessage(receiptSpec()), ['artizen.fund']);
    const r = await verify('To: attacker@example.test\r\n' + eml);
    expect(r).toMatchObject({ ok: false, reason: 'duplicate-header:to' });
  });

  it('rejects when the key is not in DNS', async () => {
    const eml = await sign(buildMessage(receiptSpec()), ['artizen.fund']);
    const r = await verifyArtizenEmail(Buffer.from(eml, 'latin1'), {
      resolver: async () => {
        const e: any = new Error('nx');
        e.code = 'ENOTFOUND';
        throw e;
      },
    });
    expect(r.ok).toBe(false);
  });
});

describe('fingerprint stability', () => {
  it('is identical across CRLF/LF, trailing blank lines and a fresh Buffer (rename)', async () => {
    const eml = await sign(buildMessage(receiptSpec()), ['artizen.fund', 'sendgrid.info']);
    const a = await verify(eml);
    const b = await verify(eml.replace(/\r\n/g, '\n'));
    const c = await verify(eml + '\r\n\r\n\r\n');
    const d = await verify(eml.replace(/\r\n/g, '\n') + '\n\n');
    const e = await verify(Buffer.from(Buffer.from(eml, 'latin1'))); // file name is not an input
    for (const r of [a, b, c, d, e]) expect(r.ok).toBe(true);
    expect(new Set([a, b, c, d, e].map((r) => r.fingerprint)).size).toBe(1);
  });

  it('differs between two different emails', async () => {
    const a = await verify(await sign(buildMessage(receiptSpec()), ['artizen.fund']));
    const b = await verify(await sign(buildMessage(receiptSpec({ date: 'Sat, 15 Aug 2026 14:03:12 +0000' })), ['artizen.fund']));
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('editing an unsigned Message-ID does not create a new fingerprint (no double claim)', async () => {
    const eml = await sign(buildMessage(receiptSpec()), ['artizen.fund']);
    const a = await verify(eml);
    const b = await verify(eml.replace('<test-msg-1@artizen.fund>', '<forged@artizen.fund>'));
    expect(b.ok).toBe(true);
    expect(b.messageId).toBe('<forged@artizen.fund>');
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it('includes Message-ID in the fingerprint when the signature covers it', async () => {
    const h = SIGNED_HEADERS + ':message-id';
    const a = await verify(await sign(buildMessage(receiptSpec()), ['artizen.fund'], h));
    expect(a.ok).toBe(true);
    const tampered = await verify(
      (await sign(buildMessage(receiptSpec()), ['artizen.fund'], h)).replace('<test-msg-1@artizen.fund>', '<x@artizen.fund>'),
    );
    expect(tampered.ok).toBe(false);
  });

  it('non-canonical base64 tail bits in b= give the same fingerprint', async () => {
    const eml = await sign(buildMessage(receiptSpec()), ['artizen.fund']);
    const a = await verify(eml);
    // 256-byte RSA sig -> 344 base64 chars ending in "X=": the last char before '=' has 2 unused bits.
    const m = eml.match(/(\bb=[A-Za-z0-9+/\s]+?)([A-Za-z0-9+/])=/)!;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const idx = alphabet.indexOf(m[2]);
    const flipped = alphabet[(idx & ~3) | ((idx & 3) ^ 1)];
    const variant = eml.replace(m[0], m[1] + flipped + '=');
    expect(variant).not.toBe(eml);
    const b = await verify(variant);
    expect(b.ok).toBe(true);
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it('rejects when To is not covered by the artizen.fund signature', async () => {
    const eml = await sign(buildMessage(receiptSpec()), ['artizen.fund'], 'content-type:date:from:subject');
    expect(await verify(eml)).toMatchObject({ ok: false, reason: 'unsigned-header:to' });
  });
});

describe('parsing', () => {
  const dashes = ['-', '–', '—', '‒', '−'];
  const spaces = [' ', ' ', '', '&nbsp;', ' &nbsp; '];
  for (const d of dashes) {
    for (const s of spaces) {
      it(`fee line with dash U+${d.charCodeAt(0).toString(16)} and space ${JSON.stringify(s)}`, () => {
        const html = `<p>Contribution${s}${d}${s}$1,250</p><p>Endowment fee${d}${s}$125.00</p><p>TOTAL COST $1,375.00</p>`;
        expect(parseReceiptBody(htmlToText(html))).toEqual({ contribution: 1250, endowmentFee: 125, totalCost: 1375 });
      });
    }
  }

  it('handles &#8211; / &#x2014; entities', () => {
    const t = htmlToText('<td>Endowment fee&#8211;&nbsp;$75.00</td><td>Contribution &#x2014; $750</td>');
    expect(parseReceiptBody(t)).toMatchObject({ contribution: 750, endowmentFee: 75 });
  });

  it('parses a quoted-printable text/plain receipt', async () => {
    const text = 'You collected 2 Artifacts from Long Name Project\nContribution – $300\nEndowment fee— $30.00\nTOTAL COST $330.00\n';
    const eml = await sign(
      buildMessage({ subject: 'You collected 2 Artifacts from Long Name Project', text, qp: true }),
      ['artizen.fund'],
    );
    expect(eml).toContain('=E2=80=93');
    const r = await verify(eml);
    expect(r).toMatchObject({ ok: true, kind: 'receipt', project: 'Long Name Project', artifacts: 2, contribution: 300, endowmentFee: 30 });
  });

  it('parses a quoted-printable HTML sold email', async () => {
    const eml = await sign(buildMessage(soldSpec({ qp: true })), ['artizen.fund', 'sendgrid.info']);
    const r = await verify(eml);
    expect(r).toMatchObject({
      ok: true,
      kind: 'sold',
      project: 'Purses',
      artifacts: 75,
      contribution: 750,
      buyerName: 'Erin',
      matchUnlocked: 2250,
    });
  });

  it('sold body parser extracts multi-word names and projects', () => {
    expect(
      parseSoldBody('Hi!\nAna María López just collected 3 Artifacts from your project The Big One. You earned $1,000.50 from the sale'),
    ).toEqual({ buyerName: 'Ana María López', artifacts: 3, project: 'The Big One', contribution: 1000.5 });
  });

  it('classifies subjects', () => {
    expect(classifySubject('You collected 1 Artifact from X')).toEqual({ kind: 'receipt', artifacts: 1, project: 'X' });
    expect(classifySubject('You sold 10 Artifacts for Y Z')).toEqual({ kind: 'sold', artifacts: 10, project: 'Y Z' });
    expect(classifySubject('Season 7 is live').kind).toBe('other');
  });

  it('missing fee line -> no-fee-line (never computed)', async () => {
    const html = '<p>Contribution - $750</p><p>TOTAL COST $825.00</p>';
    const r = await verify(await sign(buildMessage(receiptSpec({ html })), ['artizen.fund']));
    expect(r).toMatchObject({ ok: false, reason: 'no-fee-line', contribution: 750 });
    expect(r.endowmentFee).toBeUndefined();
  });

  it('missing contribution line -> no-contribution-line', async () => {
    const html = '<p>Endowment fee - $75.00</p>';
    const r = await verify(await sign(buildMessage(receiptSpec({ html })), ['artizen.fund']));
    expect(r).toMatchObject({ ok: false, reason: 'no-contribution-line' });
  });
});

describe('policy', () => {
  it('outside season -> outside-season', async () => {
    for (const date of ['Tue, 30 Jun 2026 23:59:59 +0000', 'Sun, 01 Nov 2026 00:00:00 +0000']) {
      const r = await verify(await sign(buildMessage(receiptSpec({ date })), ['artizen.fund']));
      expect(r).toMatchObject({ ok: false, reason: 'outside-season' });
    }
  });

  it('season boundaries are inclusive', async () => {
    for (const date of ['Wed, 01 Jul 2026 00:00:00 +0000', 'Sat, 31 Oct 2026 23:59:59 +0000']) {
      const r = await verify(await sign(buildMessage(receiptSpec({ date })), ['artizen.fund']));
      expect(r.ok).toBe(true);
    }
  });

  it('other subject -> not-a-receipt', async () => {
    const r = await verify(await sign(buildMessage({ subject: 'Season 7 is live', html: '<p>hi</p>' }), ['artizen.fund']));
    expect(r).toMatchObject({ ok: false, kind: 'other', reason: 'not-a-receipt' });
  });

  it('oversize -> too-large', async () => {
    const r = await verify(Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
    expect(r).toMatchObject({ ok: false, reason: 'too-large' });
  });

  it('garbage -> not-rfc822', async () => {
    expect((await verify(Buffer.from('just some text without headers'))).reason).toBe('not-rfc822');
    expect((await verify(Buffer.alloc(0))).reason).toBe('not-rfc822');
    expect((await verify(Buffer.from('%PDF-1.7\n\n\x00\x01binary'))).reason).toBe('not-rfc822');
  });
});

describe('pairSelfBacked', () => {
  const receipt = (over: Partial<Result> = {}): Result => ({
    ok: true, kind: 'receipt', to: 'a@x.test', project: 'Purses', contribution: 750, endowmentFee: 75,
    date: '2026-08-15T12:00:00.000Z', fingerprint: 'r1', ...over,
  });
  const sold = (over: Partial<Result> = {}): Result => ({
    ok: true, kind: 'sold', to: 'a@x.test', project: 'purses ', contribution: 750, buyerName: 'Erin',
    date: '2026-08-15T20:00:00.000Z', fingerprint: 's1', ...over,
  });

  it('pairs same inbox, project (case/space-insensitive), amount, within 24h', () => {
    const { receipts, unpairedSolds } = pairSelfBacked([receipt()], [sold({ project: 'P U R S E S' })]);
    expect(receipts[0]).toMatchObject({ selfBacked: true, pairedSoldFingerprint: 's1' });
    expect(unpairedSolds).toHaveLength(0);
  });

  it('does not pair a different inbox', () => {
    expect(pairSelfBacked([receipt()], [sold({ to: 'b@x.test' })]).receipts[0].selfBacked).toBe(false);
  });

  it('does not pair different amount, project, or >24h apart', () => {
    expect(pairSelfBacked([receipt()], [sold({ contribution: 751 })]).receipts[0].selfBacked).toBe(false);
    expect(pairSelfBacked([receipt()], [sold({ project: 'Hats' })]).receipts[0].selfBacked).toBe(false);
    expect(pairSelfBacked([receipt()], [sold({ date: '2026-08-16T12:00:00.001Z' })]).receipts[0].selfBacked).toBe(false);
    expect(pairSelfBacked([receipt()], [sold({ date: '2026-08-14T12:00:00.000Z' })]).receipts[0].selfBacked).toBe(true);
  });

  it('one sold pairs at most one receipt; solds never add money', () => {
    const res = pairSelfBacked([receipt({ fingerprint: 'r1' }), receipt({ fingerprint: 'r2' })], [sold()]);
    expect(res.receipts.filter((r) => r.selfBacked)).toHaveLength(1);
    expect(res.receipts).toHaveLength(2);
    const lone = pairSelfBacked([], [sold()]);
    expect(lone.receipts).toHaveLength(0);
    expect(lone.unpairedSolds).toHaveLength(1);
  });

  it('ignores not-ok inputs', () => {
    const res = pairSelfBacked([receipt({ ok: false })], [sold()]);
    expect(res.receipts[0].selfBacked).toBe(false);
  });
});
