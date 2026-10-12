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
| 2026-10-11 | Spike on Tempo Moderato: sponsor deposit, matched donation with memo, refund | Both transactions succeeded (scripts in `spike/tempo/`) |
| 2026-10-12 | MatchPool v1 deployed: `0x02b1364d6d6a4a2a73665591d2083d25e7396a5f` (1:1 match, $20 cap per donor, locked until 31 Dec 2026). $500 test match deposited | Deploy `0xe9836e53bb5b58a59c756edd34676dd2586302f4b8ca02b0ec67615d63636d2f`, deposit `0x650e4358da4971b5ae8555cf279cb44c653d69671b607513574073ef2d245564`, both succeeded |

## Zcash testnet: private pledge with a viewing key

Spike on 2026-10-12 (16:49 to 17:26 UTC). Testnet only. Data for the page: `app/src/content/zcash-pledge.json`. App tests: `app/test/zcash-pledge.test.ts`.

| Date | Check | Result |
|---|---|---|
| 2026-10-12 | Address `utest1c8lhjkqn4smha3x2ndtmjsnrk4xrczwexpuuz76hgp76c0cyjch94crsd5k5t52cj9ttakfg4d3j2y2dd7af4ants6qtt2d3zc3y7ya2` (Orchard only) funded with 0.125 TAZ from the Valar testnet faucet | Pledge tx [`8341e0d3a869bd729b1b4be00613e5399a95fb192cecbd75a26979069c75c01a`](https://testnet.cipherscan.app/tx/8341e0d3a869bd729b1b4be00613e5399a95fb192cecbd75a26979069c75c01a), block 4492820 |
| 2026-10-12 | Public explorer view of the pledge tx | Fee only (10,000 zat). No sender, no recipient, no amount |
| 2026-10-12 | Watch-only wallet made from the viewing key alone (zingo-cli, zingolib dev build with NU7, server `https://testnet.zec.rocks:443`, birthday 4492700) | Wallet kind "Loaded from unified full viewing key". Balance 12,500,000 zat. The received note shows no sender |
| 2026-10-12 | Send from the watch-only wallet | Fails: "No unified spending key found for this account. No spend capability" |
| 2026-10-12 | Send 0.001 TAZ from the seed wallet (fee 0.0001 TAZ) | Tx [`2daec20f9de9d4a4d4ef35794804adde14864d6f506a1fc8df7ea0b6585f8258`](https://testnet.cipherscan.app/tx/2daec20f9de9d4a4d4ef35794804adde14864d6f506a1fc8df7ea0b6585f8258), block 4492867 |
| 2026-10-12 | Watch-only wallet re-synced after that send | Sees the spend and the change. Balance 12,390,000 zat (0.1239 TAZ), the number on the page |
| 2026-10-12 | Server-side scan in Node with `@ledgerhq/zcash-utils` 2.6.0 and the viewing key | Finds the pledge in compact blocks, but the full read fails: the library predates testnet NU7 (branch ID 0x77190AD9) |

Verify it yourself:

```
zingo-cli --chain testnet --server https://testnet.zec.rocks:443 --viewkey <UFVK> --birthday 4492700 --waitsync balance
```

The full viewing key is on the pledge page under "Verify it yourself". zingo-cli v6 also asks for a Nym proxy (`--nym-proxy`) on connected sessions.

Not live yet: the page shows the balance checked on 12 Oct 2026, not a live read. A server-side balance read waits on NU7 support in `@ledgerhq/zcash-utils`. Mainnet has not been tried.

## Live site (pledger.impacthook.org)

| Date | Check | Result |
|---|---|---|
| 2026-10-12 | Every page and the pool data route respond on the live site | 200 on /, both pledge pages, /claim, /terms, /api/pools/test-match-pool |
| 2026-10-12 | Live test-money route funds a fresh test wallet | Funded, faucet transactions returned |
| 2026-10-12 | "Try it" end to end in a browser: test money, fee-free donation, match, result card, activity log | Matched gifts and a "this visitor's $20 match was already used" case, all confirmed on Tempo testnet |
| 2026-10-12 | Live receipt check with the database connected: a real buyer receipt plus its "You sold" email | Signatures valid; the pledge owner's receipt is correctly excluded from the line |
| 2026-10-12 | Crawled every internal link on the home, Artizen, line and make pages | All return 200 |
| 2026-10-12 | Help by amount: allocation tests (whole people only, leftover shown with the amount the next person needs, next N people includes every entry of a selected person, skips paid entries) | Passed; live route answers with the real (empty) line |

## Payment rule (app)

| Date | Rule | Where |
|---|---|---|
| 2026-10-12 | Exact amount: a payment counts for a person only if it is their full remaining 10%, give or take 0.5%, sent after they joined the line, from someone other than themselves. Anything else is rejected with the reason ("Sent before this claim was made", "A wallet cannot pay itself", "Does not match what is owed"). Help by amount pays whole people only and shows what is left over. | `app/src/lib/`, app tests in `app/test/` (`cd app && npx vitest run`) |
| 2026-10-12 | Holds and extras (sql/005): held people are skipped by the split and marked on the line, holds end after 10 minutes, the helper's own hold does not hide people from them, "paying outside Pledger" holds with source outside, holds never block recording. A wrong amount is recorded as an extra, shown on the row and left out of paid, owed, totals and public records; sent before the claim stays rejected. Before 005 runs (no holds table, no kind column) the app falls back to no holds and reject-and-log. | `app/test/holds-extras.test.ts`, `app/test/payment-rule.test.ts`: 116 app tests passed |
| 2026-10-12 | Rate limits and faucet cap (sql/006): per-IP limiter, held in memory per server instance (a speed bump, not a wall) (window, reset, IP isolation), 429 shape on claims/verify, global cap of 40 an hour on the demo faucet (the 40-per-hour cap needs sql/006), fallback to the in-memory limit before 006 runs | `app/test/ratelimit.test.ts`, `app/test/ratelimit-route.test.ts`, `app/test/faucet-cap.test.ts`: 139 app tests passed |

Not yet exercised end to end on the live site: a full claim submission signed by a wallet (needs a receipt from someone other than the pledge owner), a real Base payment check, the wallet batch send (EIP-5792), public records (needs the records wallet), and a card payment (Stripe sandbox purchase not run yet).

| Date | Check | Result |
|---|---|---|
| 2026-10-12 | Final run of all suites | app 161 passed (19 files); verify 55 passed + 1 skipped (needs a real .eml); forge 40 passed |
