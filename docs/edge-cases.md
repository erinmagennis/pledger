# Edge cases and how Pledger handles them

Status key: **TESTED** = a test or a real-data check exists. **RULE** = built into the code, test comes with the app. **PLANNED** = decided, not built yet. **ASK** = needs the pledge owner's decision.

## Receipt check (Artizen emails, DKIM)

Real-data checks run on 2026-10-12 against a genuine Artizen email:

| Case | Result | Status |
|---|---|---|
| Original email | Valid | TESTED |
| Same email, file renamed | Valid, same fingerprint, so a second upload is rejected | TESTED |
| Message-ID header edited (not covered by Artizen's signature) | Same fingerprint, so it cannot be used to claim twice | TESTED |
| Recipient (To) changed | Signature fails | TESTED |
| Subject changed | Signature fails | TESTED |
| Amount in the body changed | Signature fails (body hash mismatch) | TESTED |
| Line endings changed (Windows vs Mac) | Still valid, same fingerprint | TESTED |
| Extra blank lines at the end | Still valid, same fingerprint | TESTED |
| **Artizen's signature stripped, the email service's (SendGrid) signature left** | A naive check passes it. **Pledger only accepts a valid signature whose domain is artizen.fund and matches the From domain** | TESTED (bug found, rule set) |

Still to build tests for:
- Forwarded email (signature broken): the user sees "Download the original from your inbox" with steps for Gmail, Proton, Yahoo and Outlook. RULE
- Artizen email that is not a receipt (newsletter, "You sold" without a matching buyer receipt): it can prove ownership but never adds money. RULE
- Two identical purchases on the same day (same project, same amount): different Message-IDs, so both count. RULE
- Fee taken from the "Endowment fee" line, never computed. Card processing fees are not claimable. If the line is missing, the email is not counted (RULE); sending it to manual review instead is PLANNED.
- Artizen's signing key removed from DNS later: new checks stop working. Verify early and store the result. A manual review queue for these emails is PLANNED.
- Wrong file type, oversized files, zip files, HTML-only emails, encoded bodies, non-English names: clear error or decode correctly. RULE
- The same email uploaded by two different people: the first verified claim keeps it, and the second sees "already claimed". RULE
- Pledge owner's own receipts: excluded from the line, used only for the demo. RULE
- Earlier Artizen seasons (before Season 7): eligible or not? ASK
- Refunded purchases: these can't be detected from email. Claims carry a "not refunded" confirmation. ASK

## Self-backing (who goes first)

- A buyer receipt and a "You sold" email received at the same address, for the same date, project and amount, means a self-backed purchase. RULE
- A "You sold" email for a sale to someone else proves ownership only, not self-backing. RULE
- Someone backed their own project and also others: the self-backed fees sit in the first group and the rest in the second. RULE

## The line

- One place per person. Self-backed total first, then the rest, smallest first. Ties go to whoever submitted earlier. RULE
- Display: full name, initials (default) or project only. Email addresses are never shown, and only a hash is stored. RULE
- A claimant loses their wallet: a payout-address change needs a signature from the old wallet. If the old wallet is lost, the change goes to manual review. PLANNED

## Payments (mark paid)

- Pasted transaction on the wrong chain, wrong token (only native USDC on Base counts), reverted or still pending: rejected with the reason. RULE
- Amount: a payment counts only if it is the person's full remaining 10%, give or take 0.5%, sent after they joined the line, from someone other than themselves. Any other amount is not counted (see the next line). RULE
- Paid more than owed, less than owed, or to someone who owes nothing: the real payment is recorded as an extra. It shows on the person's row as "Also received $X.XX, over what was owed" with a Basescan link, and never counts toward paid, owed, totals or public records. The payer sees "Recorded as extra: it does not match what this person is owed ($X.XX)". Sent before the claim and self-transfers are still rejected and not recorded. An extra under $1.00, or past 5 extras for one person, is rejected and logged instead of stored. Until sql/005 runs, a wrong amount is rejected and logged as before. RULE (tests in `app/test/payment-rule.test.ts`, `app/test/holds-extras.test.ts`)
- An extra can be turned into a counted payment by hand: `update public.pledger_payments set kind='paid' where tx_hash=... and to_address=...`. The pledge owner (Erin) decides each one. MANUAL
- Two helpers pay the same person at once: opening Pay on a person, or a "Help pay people back" preview, holds those people for 10 minutes, refreshed when the payer signs. "Help pay people back" skips held people, and their rows show "Someone is paying this person now" with the time the hold ends. "I'm paying this outside Pledger" on a row holds the person the same way and shows the exact amount and full address. A hold never blocks recording a payment, and if two helpers still pay, the second payment is recorded as an extra. One request holds up to 10 people, and one IP holds up to 10 at once (holding more ends its oldest holds). If more than half of the open people are held, "Help pay people back" ignores holds for that split. Until sql/005 runs, nobody is held. RULE (tests in `app/test/holds-extras.test.ts`)
- Paid to the wrong address: not counted. RULE
- The same transaction pasted twice, or for two claims: counted once. A batch transaction paying several people at once: each transfer is matched to its claim. RULE
- Payment arrives before the claim is verified: held as "received, checking". PLANNED (for now it is rejected as "Sent before this claim was made")
- Payout address is an exchange deposit address: warning shown before saving. PLANNED
- Sanctions screening on payout addresses before the pledge owner pays. PLANNED

## Public records (EAS on Base)

- An attestation fails (out of gas, network error): the claim is still saved. The attestation is retried in place when a later payment or claim triggers recordClaims and the row errored or is older than 10 minutes. There is no cron, and the UI does not show "record pending" (that part is PLANNED). RULE
- No personal data on chain: only the fingerprint, fee, project, group and status. RULE

## Demo match pool ("Try it", test money)

- One person making many throwaway wallets: limited per visitor, a small match per wallet, and Pledger can top up the pool. RULE
- Faucet or fee sponsor down: a clear message. RULE. A backup pre-funded demo wallet is PLANNED.
- Faucet down / abused: 3 wallets per IP an hour (in memory), and at most 40 fundings an hour across everyone (`pledger_faucet_log`, sql/006); over either it answers 429 with a plain message. Before 006 runs only the per-IP limit applies. The claim, onramp and payment routes also answer 429 after too many requests from one IP in 10 minutes (`app/src/lib/ratelimit.ts`). RULE
- Match used up: "Your $20 match was already used" shows, and donations still go through. RULE
- Lock date passing while judges review (winners by Dec 5): the demo pool is locked until 31 Dec 2026. RULE
- Browser storage blocked (private mode): the wallet lives in memory for the visit. RULE

## Contract (MatchPool v1)

Covered by `contracts/test/` (40 tests, all passing: 20 core plus 20 edge cases including a blocked recipient, a token that re-enters mid-transfer, overflow, the lock boundary and a 1,000-run random-sequence fuzz): sponsor cannot withdraw before the lock, per-donor cap, pool exhaustion, lock boundary, failed transfers roll back, memo receipts, a fuzz test of the money totals.

Behaviors to state in the product:
- The per-donor cap counts addresses, not people. Real pools need an allowlist or identity check.
- Matching stays open through the lock second itself. The sponsor can withdraw from the next second on.
- A blocked recipient makes every donation fail cleanly, so nobody loses funds. The app shows this as an error.
- Rounding favors the pool: tiny donations can get no match.
- Match ratios above 1:1 work. The create-pledge form limiting the ratio to a sensible range is PLANNED.
