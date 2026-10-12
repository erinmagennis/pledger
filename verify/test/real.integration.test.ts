import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifyArtizenEmail } from '../src/index.js';

// Runs only when REAL_EML_PATH points at a real Artizen "You sold" email. Uses real public DNS.
// Privacy: prints only the asserted fields, never headers or body.
const path = process.env.REAL_EML_PATH;

describe.skipIf(!path)('real Artizen email (REAL_EML_PATH)', () => {
  it('verifies against live DNS', async () => {
    const r = await verifyArtizenEmail(readFileSync(path!));
    const shown = { ok: r.ok, reason: r.reason, kind: r.kind, project: r.project, contribution: r.contribution, buyerName: r.buyerName };
    console.log('REAL_EML result:', JSON.stringify(shown));
    expect(shown).toMatchObject({ ok: true, kind: 'sold', project: 'Purses', contribution: 750, buyerName: 'Erin' });
  }, 30_000);
});
