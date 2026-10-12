# Edge cases and how Pledger handles them

Status key: **TESTED** = a test or a real-data check exists. **RULE** = built into the design, test comes with the app. **ASK** = needs the pledge owner's decision.

## Receipt check (Artizen emails, DKIM)

Real-data checks run on 2026-10-12 against a genuine Artizen email:

| Case | Result | Status |
|---|---|---|
| Original email | Valid | TESTED |
| Same email, file renamed | Valid, same fingerprint, so a second upload is rejected | TESTED |
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
- Fee taken from the "Endowment fee" line, never computed. Card processing fees are not claimable. If the line is missing, the email goes to manual review. RULE
- Artizen's signing key removed from DNS later: new checks stop working, and the email goes to a manual review queue. Verify early and store the result. RULE
- Wrong file type, oversized files, zip files, HTML-only emails, encoded bodies, non-English names: clear error or decode correctly. RULE
- The same email uploaded by two different people: the first verified claim keeps it, and the second sees "already claimed" with a contact link. RULE
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
- A claimant loses their wallet: a payout-address change needs a signature from the old wallet. If the old wallet is lost, the change goes to manual review. RULE

## Payments (mark paid)

- Pasted transaction on the wrong chain, wrong token (only native USDC on Base counts), reverted or still pending: rejected with the reason. RULE
- Paid less than owed: shown as "Paid $X of $Y", and the claim stays in line for the rest. Paid more than owed: recorded, with a note. RULE
- Paid to the wrong address: not counted. RULE
- The same transaction pasted twice, or for two claims: counted once. A batch transaction paying several people at once: each transfer is matched to its claim. RULE
- Payment arrives before the claim is verified: held as "received, checking". RULE
- Payout address is an exchange deposit address: warning shown before saving. RULE
- Sanctions screening on payout addresses before the pledge owner pays. RULE

## Public records (EAS on Base)

- An attestation fails (out of gas, network error): the claim is still saved and the attestation retries. The page shows "record pending". RULE
- No personal data on chain: only the fingerprint, fee, project, group and status. RULE

## Test match pool ("Try it")

- One person making many throwaway wallets: limited per visitor, a small match per wallet, and Pledger can top up the pool. RULE
- Faucet or fee sponsor down: a clear message plus a backup pre-funded demo wallet. RULE
- Match used up: "This match is used up" shows, and donations still go through. RULE
- Lock date passing while judges review (winners by Dec 5): the demo pool is locked until 31 Dec 2026. RULE
- Browser storage blocked (private mode): the wallet lives in memory for the visit. RULE

## Contract (MatchPool v1)

Covered by `contracts/test/` (40 tests, all passing: 20 core plus 20 edge cases including a blocked recipient, a token that re-enters mid-transfer, overflow, the lock boundary and a 1,000-run random-sequence fuzz): sponsor cannot withdraw before the lock, per-donor cap, pool exhaustion, lock boundary, failed transfers roll back, memo receipts, a fuzz test of the money totals.

Behaviors to state in the product:
- The per-donor cap counts addresses, not people. Real pools need an allowlist or identity check.
- Matching stays open through the lock second itself. The sponsor can withdraw from the next second on.
- A blocked recipient makes every donation fail cleanly, so nobody loses funds. The app shows this as an error.
- Rounding favors the pool: tiny donations can get no match.
- Match ratios above 1:1 work. The create-pledge form limits the ratio to a sensible range.
