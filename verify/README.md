# verify

Standalone module that checks an Artizen receipt email (`.eml`) is real and pulls out the claim facts.

```ts
import { verifyArtizenEmail, pairSelfBacked } from './src/index.ts';
const r = await verifyArtizenEmail(rawBuffer); // { ok, reason?, kind, fingerprint, to, project, contribution, ... }
```

Node 22, npm. `npm test` runs the unit tests. `npm run typecheck` runs tsc.

## What it checks, in order

1. **Size and shape.** Over 2 MB: `too-large`. No header block, no From/Date/Subject: `not-rfc822`. Missing To or Message-ID: `no-to` / `no-message-id`. More than one From, To, Subject, Date or Message-ID header: `duplicate-header:<name>` (blocks the trick of adding a second To that a parser reads but DKIM ignores).
2. **DKIM** (via `mailauth`). Line endings are normalized to CRLF first.
   - The From header must be a single address at exactly `artizen.fund`, else `from-not-artizen` / `bad-from`.
   - There must be a DKIM signature with `d=artizen.fund` (exact match) and status `pass`. A pass from `sendgrid.info` or any other domain does not count: `no-artizen-signature`. A failing artizen signature gives `dkim-fail` / `dkim-neutral` / etc.
   - The artizen signature must cover `from`, `to`, `subject` and `date`, else `unsigned-header:<name>`. A signature with an `l=` body limit is rejected (`dkim-partial-body`).
   - DNS goes to 8.8.8.8 / 1.1.1.1 (the local resolver fails on SendGrid's CNAME key), and TXT lookups follow CNAMEs by hand. Pass `{ resolver }` to override (tests use a stub).
3. **Kind** from the subject.
   - `You collected N Artifacts from <Project>`: `receipt`.
   - `You sold N Artifacts for <Project>`: `sold`.
   - Anything else: `ok:false`, `kind:'other'`, `not-a-receipt`.
4. **Season.** Date header must fall in `SEASON` (Season 7: 2026-07-01 to 2026-10-31 UTC, inclusive). Else `outside-season`. Change the constant in `src/index.ts`.
5. **Body.** HTML part preferred (tags stripped, entities decoded), else text/plain. Quoted-printable and base64 are decoded. Hyphen, en dash, em dash, minus and nbsp variants are all treated the same.
   - Receipt: `Contribution - $750` gives `contribution`, `Endowment fee– $75.00` gives `endowmentFee`, `TOTAL COST $825.00` gives `totalCost`. The fee is only ever read from its line, never computed. No fee line: `no-fee-line`. No contribution line: `no-contribution-line`.
   - Sold: `<Name> just collected N Artifacts from your project <Project> . You earned $750 from the sale and unlocked $2,250 in match funding` gives `buyerName`, `contribution` (earned) and `matchUnlocked`. No match: `no-sale-line`.

## Fingerprint

`sha256hex("<signedMessageId>|<b>")` where `b` is the artizen.fund signature value, decoded and re-encoded as canonical base64.

- `signedMessageId` is the Message-ID only when the artizen.fund signature covers it, else empty. Artizen's real signature does **not** cover Message-ID, so anyone could edit it and get a fresh fingerprint for the same receipt. Leaving it out stops that double claim. `b=` already commits to the body and signed headers, so it is unique per email.
- Re-encoding `b=` stops a second fingerprint from whitespace or the unused tail bits of the last base64 character (DKIM still passes with those changed).
- Stable across file renames, CRLF/LF changes and trailing blank lines (tested).

## pairSelfBacked(receipts, solds)

Marks a receipt `selfBacked: true` when an ok `sold` result has the same `to`, the same project (ignoring case and spaces), the same contribution, and a date within 24 hours. Each sold email pairs with at most one receipt (closest in time). Sold emails never add money; unmatched ones come back in `unpairedSolds` for information only.

## Tests

- `test/verify.test.ts`: synthetic emails signed with RSA keys generated at test time, with a stub DNS resolver. Covers valid pass, sendgrid-only, From mismatch, tampered body, tampered To, duplicate To, missing key, fingerprint stability, Message-ID and `b=` malleability, dash formats, QP, missing lines, season edges, not-a-receipt, oversize, garbage, pairing.
- `test/real.integration.test.ts`: runs only when `REAL_EML_PATH` is set, against live DNS. Prints only ok, reason, kind, project, contribution, buyerName. Real emails are never committed (`*.eml` is gitignored).

```sh
REAL_EML_PATH="/path/to/You sold 75 Artifacts for Purses.eml" npx vitest run test/real.integration.test.ts
```
