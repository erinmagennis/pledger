# Testing log

Every check that has been run, with the date and the result. Updated with each push.

## Contract: MatchPool v1 (`contracts/`)

Run: `cd contracts && forge test`

| Date | Suite | Result |
|---|---|---|
| 2026-10-12 | Core tests (`test/MatchPool.t.sol`): deposits, 1:1 and 50% match, per-donor cap, pool running out, lock boundary, failed transfers, memo receipts, totals, 1,000-run fuzz | 20 passed, 0 failed |
| 2026-10-12 | Edge cases (`test/MatchPool.edge.t.sol`): sponsor or recipient donating, overflow, missing allowance, zero ratio or cap, 2:1 match, pool drained to zero, double withdraw, blocked recipient, a token that re-enters mid-transfer, rounding, exact lock second, 1,000 random sequences | 20 passed, 0 failed, no contract bugs found |

Money invariants checked after every random step: contract balance equals the pool; matched plus pool equals deposited minus withdrawn; the recipient received exactly donations plus match; no donor's match exceeds the cap.

## Receipt check (DKIM on Artizen emails)

Run on 2026-10-12 against a genuine Artizen email:

| Case | Result |
|---|---|
| Original | Valid |
| File renamed | Valid, same fingerprint (second upload rejected) |
| Recipient, subject or amount edited | Signature fails |
| Line endings changed, blank lines added | Valid, same fingerprint |
| Artizen's signature stripped, the email service's signature left | Passed a naive check. Fixed by rule: only a valid artizen.fund signature that matches the sender counts |

## Receipt checker module (`verify/`)

Run: `cd verify && npx vitest run`

| Date | Suite | Result |
|---|---|---|
| 2026-10-12 | Unit tests with locally signed test emails: valid pass, signature from another domain only, edited body, edited recipient, renamed file, line endings, trailing lines, duplicate headers, odd dash formats, missing fee line, outside Season 7, not a receipt, oversized file, self-backed pairing | 55 passed |
| 2026-10-12 | Live check against a real Artizen "You sold" email (real DNS) | Passed: project, amount and buyer read correctly |
| 2026-10-12 | Live check against a real Artizen "You collected" buyer receipt (real DNS) | Passed: signature valid, project, 75 artifacts, $750 contribution, $75 endowment fee, $825 total read correctly |
| 2026-10-12 | Real receipt paired with the real "You sold" email for the same purchase | Marked self-backed; the sold email added no money |
| 2026-10-12 | Exact duplicate of a real email uploaded again | Same fingerprint, rejected as already claimed |

Two fingerprint bugs found and fixed while testing:
- Artizen's signature does not cover the Message-ID header, so a fingerprint built from it could be changed by editing that header (a double claim). The fingerprint now uses the signature itself, plus the Message-ID only when the signature covers it.
- The last character of a signature can be altered without breaking the check. The signature is normalized before hashing.

## Testnet

| Date | Check | Result |
|---|---|---|
| 2026-10-11 | Spike on Tempo Moderato: sponsor deposit, matched donation with memo, refund | Both transactions succeeded (see README) |
| 2026-10-12 | MatchPool v1 deployed: `0x02b1364d6d6a4a2a73665591d2083d25e7396a5f` (1:1 match, $20 cap per donor, locked until 31 Dec 2026). $500 test match deposited | Deploy `0xe9836e53bb5b58a59c756edd34676dd2586302f4b8ca02b0ec67615d63636d2f`, deposit `0x650e4358da4971b5ae8555cf279cb44c653d69671b607513574073ef2d245564`, both succeeded |

## Live site (pledger.impacthook.org)

| Date | Check | Result |
|---|---|---|
| 2026-10-12 | Every page and the pool data route respond on the live site | 200 on /, both pledge pages, /claim, /terms, /api/pools/test-match-pool |
| 2026-10-12 | Live test-money route funds a fresh test wallet | Funded, faucet transactions returned |
| 2026-10-12 | "Try it" end to end in a browser: test money, fee-free donation, match, result card, activity log | Matched gifts and a "match used up" case, all confirmed on Tempo testnet |
| 2026-10-12 | Live receipt check with the database connected: a real buyer receipt plus its "You sold" email | Signatures valid; the pledge owner's receipt is correctly excluded from the line |

Not yet exercised end to end on the live site: a full claim submission signed by a wallet (needs a receipt from someone other than the pledge owner), a real Base payment check, public records (needs the records wallet), and card payments (needs Stripe approval).
