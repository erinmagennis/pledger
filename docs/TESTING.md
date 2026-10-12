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

## Testnet

| Date | Check | Result |
|---|---|---|
| 2026-10-11 | Spike on Tempo Moderato: sponsor deposit, matched donation with memo, refund | Both transactions succeeded (see README) |
