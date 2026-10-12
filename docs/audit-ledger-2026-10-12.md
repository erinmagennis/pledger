# Ledger state audit, 12 Oct 2026

Scope: `app/` at commit cb3a7ff (rate limits added mid-audit; re-read and included). Method: state-inconsistency auditor (coupled state map, mutation matrix, parallel paths, journeys, masking code), then code trace for every finding and a vitest PoC for five of them. The PoCs ran from a scratch folder against the real `src/lib` code and `test/fake-db.ts`; no project file was changed. Project suite: 17 files, 139 tests passing.

## Status after fixes (24dd302)

Fixed in commit 24dd302: SI-01, SI-02 (partly: the attestation is retried in place, but there is no EAS lookup before the retry), and SI-03 (stopgap: localStorage replay of a sent transfer). SI-04 to SI-14 are open; see the backlog in `notes/2026-10-12-backlog.md`.

## Summary

Pledger keeps one money fact in four places: the USDC transfer on Base, the `pledger_payments` row, the derived line (`buildLine`), and the EAS attestation. Only the first is durable without help. A payment that lands on chain becomes a DB row only when a browser or the Stripe webhook asks for it, and the browser keeps that "sent but not recorded" state in memory only. The new 30-per-10-minute limit on `/api/payments/verify` makes this worse: "Help pay" treats a 429 as a final answer and forgets a sent transfer, so a person who was paid stays "owed" and the next helper is sent to them. The public record has the same shape: the "paid" attestation fires once, after the response, and any failure (RPC down, attester not configured, function cut off, a read error) leaves a `pending` row that the unique index from sql/004 then blocks from ever being retried, while the page says "Paid" and the rule card says every payment is recorded on Base. Before sql/004, two valid payments racing for the same person (both stored as `paid`, PoC verified) attest that person twice. No sequence of valid calls produces "paid" with zero counted payment in the DB, but two do produce "owed after being paid" (a sent transfer the server never saw, and a later claim that re-spreads an old payment), and holds can be renewed without limit to push helpers' money past people in line.

## Ranked findings

| ID | Severity | Title | Verified |
|----|----------|-------|----------|
| SI-01 | HIGH | Help pay forgets a sent transfer on 429 (and on the 003 error) | Code trace |
| SI-02 | HIGH | "Paid" attestation is fire-once; a pending row can never be retried after 004 | PoC + trace |
| SI-03 | HIGH | Chain and DB have no reconciler; "sent, not recorded" lives only in a tab | Code trace |
| SI-04 | MEDIUM | A partly failed wallet batch is treated as "nothing moved" | Code trace |
| SI-05 | MEDIUM | Two valid payments race: both stored `paid`, attested twice before 004 | PoC |
| SI-06 | MEDIUM | A new claim re-spreads an old payment: "Paid" becomes "Paid $7 of $10" | PoC |
| SI-07 | MEDIUM | Holds renew forever and can steer Help pay past people | Code trace |
| SI-08 | MEDIUM | Anyone can attach unrelated incoming USDC to a person as a public "extra" | Code trace |
| SI-09 | LOW | `record_state` holds whichever status ran last and is never read | PoC |
| SI-10 | LOW | Self-pay from a second wallet marks a person paid and attested | Code trace |
| SI-11 | LOW | Browser hold cache is lost on reload: own hold looks like someone else's | Code trace |
| SI-12 | LOW | Extras cap is read-then-insert over a global top-200 window | Code trace |
| SI-13 | LOW | 5000-row read windows; home ISR and shortAddress keys | Code trace |
| SI-14 | LOW | Webhook outcomes that are final with money on chain and no row | Code trace |

### SI-01 HIGH: Help pay forgets a sent transfer on 429

**Coupled pair:** USDC transfer on Base ↔ `pending` list in `HelpPay` (the only record that a transfer still needs recording).

**Breaking operation:** `record()` in `app/src/components/claim/HelpPay.tsx:36-47` maps any non-OK answer to `final: !retryable(...)`, and `retryable` (`HelpPay.tsx:33`) is only `status >= 500 || /not found/`. A 429 from `app/src/app/api/payments/verify/route.ts:15` (30 calls per IP per 10 minutes, in memory, `app/src/lib/ratelimit.ts:11-22`) is therefore final. `recordAll` drops a final item (`HelpPay.tsx:165-167`, only non-final items go to `left`), and the one-by-one path drops it too (`HelpPay.tsx:227`, `if (r.ok || r.final)` removes it). The same happens for the "Batch payments need the 003 update" answer (409, `HelpPay.tsx:163`).

**Sequence:**
1. The line has 31 or more small claims (or several helpers share one IP: a venue wifi at a demo).
2. A helper picks an amount that covers 31 people (`MAX_N` is 50, `app/src/app/api/line/allocate/route.ts:11`), sends one batch; every transfer lands on Base.
3. `recordAll` calls `/api/payments/verify` once per person. Call 31 gets 429.
4. Person 31 is dropped from `pending`. The "Check again" button disappears once `pending` is empty, and the error text is the only trace.

**Consequence:** person 31 is paid on chain and shows "Waiting" with full amount owed. After the 10-minute hold, Help pay sends the next helper to them. Whichever tx is recorded first counts; the other becomes an extra if someone records it. On a shared IP the hold route (60 per 10 min) also fails quietly, so double payment is more likely, not less.

**Fix:** treat 429 (and the 003 answer) as retryable in `retryable()`; keep a sent item until the server says `ok` or a rule rejection, never on a transport or limit error. Exempt `payments-verify` from the per-IP limit when the tx hash is new and verified on Base, or key the limit on tx hash rather than IP. Persist `pending` (see SI-03).

### SI-02 HIGH: "Paid" attestation is fire-once and cannot be retried after 004

**Coupled pair:** line status "paid" (derived from `pledger_payments`) ↔ `pledger_attestations` row with `status='paid', state='recorded'`.

**Breaking operations:**
- The trigger fires only on the step from not-all-paid to all-paid, seen inside one request (`app/src/lib/payments-server.ts:112-128`). If the second `readPayments` fails, `.catch(() => [])` (`payments-server.ts:112`) makes `mine` not paid, so no attestation is scheduled. Masking pattern: fallback to default. Every later payment to that person is `owed = 0`, so an extra, so the step never happens again.
- `recordClaims` claims a slot first (`app/src/lib/eas.ts:65-71`). If `attest` returns `pending` (RPC error, out of gas, a nonce clash between two concurrent `after()` jobs on one attester key, or `eas-not-configured`, `eas.ts:29`), the row stays `pending`. Any retry through `recordClaims` inserts again, hits the unique index from sql/004, and `continue`s (`eas.ts:71`). PoC: after one failed try, a second call with a working attester made 0 attest calls and the row stayed `pending`.
- `after()` (`payments-server.ts:47`, `114`) runs past the response and is cut off at the function's time limit. A person with many claims is attested one `tx.wait()` at a time (`eas.ts:60-87`). If the function stops after the slot insert, the row is `pending` with no uid even if the tx was sent; later claims get no row at all.
- Any non-23505 slot insert error also `continue`s with no row and no log (`eas.ts:71`, `84-86`).

**What the page shows:** the line, home and pledge pages say "Paid" and count the money. Nothing shows the record state (`docs/edge-cases.md:60` marks "record pending" as planned). The rule card says "Every checked claim and every payment is recorded on Base" (`app/src/lib/pledges.ts:104`).

**Fix:** make attestation a reconcilable job, not a one-shot side effect. (1) Derive "should be attested paid" from the data: every claim of an all-paid person without a `recorded` row. (2) A retry path (cron or admin route) that picks rows with `state='pending'` and `uid is null` older than N minutes, checks EAS for an existing attestation for that fingerprint before sending, then updates the row instead of inserting. (3) Replace `.catch(() => [])` at `payments-server.ts:112` with a failure that leaves a marker for the retry job. (4) Until then, soften the rule card line or show "record pending" on rows.

### SI-03 HIGH: no reconciler between chain and DB

**Coupled pair:** USDC transfers to a claimant on Base ↔ `pledger_payments` rows.

**Breaking operation:** a row is written only by `recordUsdcPayment` (`payments-server.ts:50`), called by `/api/payments/verify` (client) and `/api/onramp/webhook` (card). The wallet paths keep the tx hash in React state only: `PayPanel` `hash` (`app/src/components/claim/PayPanel.tsx:44`, `93`), `HelpPay` `pending` and `callsId` (`HelpPay.tsx:77-78`). There is no server scan of USDC transfers to claimant addresses.

**Sequence:** helper presses Pay, confirms, closes the tab (or the phone kills it) before Base confirms. The transfer lands. Nothing records it. The person shows "Waiting"; after 10 minutes the hold ends and Help pay sends the next helper.

**Consequence:** "owed after being paid" for an unbounded time; the only recovery is someone pasting the tx link. Home totals understate.

**Fix:** store the tx hash server side at send time (a `pledger_payment_intents` row keyed by tx hash and address, created before or right after the wallet returns the hash), and have the line route or a cron verify open intents. Cheaper interim: write sent hashes to `localStorage` and replay them on load.

### SI-04 MEDIUM: a partly failed wallet batch is treated as "nothing moved"

**Breaking operation:** `confirmBatch` (`HelpPay.tsx:187-199`) clears `callsId` and throws "The batch did not go through" whenever `status.status !== "success"`. EIP-5792 wallets that run calls as separate transactions can report failure when some calls succeeded, and `status.receipts` then holds receipts for the ones that did. Those hashes are shown (`setHashes`, `HelpPay.tsx:191`) but never recorded, and Send comes back.

**Consequence:** people paid in the successful calls stay "owed"; pressing Send again pays them twice.

**Fix:** on non-success, record every receipt with `status === "success"` before clearing state; only offer Send again when no receipt succeeded.

### SI-05 MEDIUM: two valid payments race, both stored `paid`

**Coupled pair:** owed amount read in the rule check ↔ the payments inserted after it.

**Breaking operation:** `recordUsdcPayment` reads payments (`payments-server.ts:68`), computes `owed` and checks the rule (`payments-server.ts:72-75`), then inserts (`payments-server.ts:104`) with no lock. The unique index is (tx_hash, to_address), so two different txs both pass.

**Sequence (PoC verified):** person owes $10. Helper A (Pay button) and helper B (Help pay with holds ignored, or a card payment) each send $10. Both verify calls run at once. Both see owed $10, both insert `kind='paid'`, both see the step to all-paid, both schedule an attestation (PoC: 2 `paid` rows, 2 attest calls).

**Consequence:** the second $10 is counted, not shown as an extra. Totals stay right only because `paidFromLine` caps per entry (`app/src/lib/claims.ts:433-435`, masking pattern: min cap). The home feed lists two give-backs (`pledges.ts:360-366`). If the person later adds a claim, the hidden surplus silently pays it (see SI-06). Before sql/004 both attestation jobs send on-chain records for every claim; after 004 only one does.

**Fix:** serialize per address. Easiest in Supabase: a Postgres function `pledger_record_payment(...)` that takes `pg_advisory_xact_lock(hashtext(to_address))`, recomputes owed from rows, and inserts with the right `kind` in one transaction. Or re-check after insert: if the sum of `paid` rows now exceeds the fee by more than 0.5%, flip the newest row to `extra`.

### SI-06 MEDIUM: a new claim re-spreads an old payment

**Coupled pair:** a person's entries (fee per group) ↔ the payments that filled them.

**Breaking operation:** `fillPerson` (`claims.ts:311-328`) fills a person's entries in line order from the sum of payments, and line order puts self-backed (group 1) first (`claims.ts:362-367`). Payments are not tied to the claims they paid.

**Sequence (PoC verified):** a person's "backed others" claim is $10, paid $10, and attested "paid". They later submit a $3 self-backed receipt. The line now shows the new $3 place as "Paid" (no payment was made after it) and the old place as "Paid $7 of $10"; owed becomes $3.

**Consequence:** "owed after being paid", and the on-chain "paid" record for the first claim now disagrees with the line. When the $3 is paid, the step to all-paid fires again and attests every claim (before 004 the first claim is attested "paid" twice; after 004 it is skipped).

**Fix:** decide the rule in writing first. Option A: fill entries in claim time order, so old payments stay with old claims. Option B: refuse new claims from an address that is all paid, or start them as a new person. Either way, log the decision in the rule copy since the rule is fixed after 12 Oct.

### SI-07 MEDIUM: holds renew forever and can steer Help pay

**Coupled pair:** `pledger_holds.expires_at` ↔ who Help pay sends money to.

**Breaking operation:** every `POST /api/line/hold` inserts a new row with `expires_at = now + 10 min` (`app/src/lib/claims-server.ts:192-204`); the latest expiry wins (`claims-server.ts:164-171`). Nothing ties a hold to an actual payer or caps renewals. The per-IP cap of 10 people (`app/src/app/api/line/hold/route.ts:21-42`) and the request limit (`hold/route.ts:62`) live in memory per server instance and key on `x-forwarded-for` (`app/src/lib/ratelimit.ts:25-29`).

**Sequence:** the person at place 12 runs a script that holds places 1 to 10 every 9 minutes from one IP. Help pay skips held people (`app/src/lib/allocate.ts:63`), so helpers' money goes to place 11, 12 and on. The fail-open rule only trips when more than half of open people are held (`allocate/route.ts:64`). On the row, "I'm paying this outside Pledger" is hidden for held people (`app/src/components/claim/LineList.tsx:103`).

**Answer to "a hold that never expires":** no single row lives past 10 minutes, and rows over a day old are pruned (`claims-server.ts:197`), but a person can be kept held for as long as someone keeps calling.

**Related:** the browser holds only the first 10 people of a split (`app/src/components/claim/holds.ts:18`) while a split can have 50, so people 11 to 50 are not held during a large send.

**Fix:** cap total hold time per person (for example 2 holds per person per hour, counted in the DB, not in memory); ignore holds from a source that already holds people ahead of its own pid; hold up to `MAX_N` per split, or lower `MAX_N` to 10.

### SI-08 MEDIUM: unrelated incoming USDC becomes a public "extra"

**Breaking operation:** `/api/payments/verify` accepts any tx hash for any claimant address. Any USDC transfer of $1 or more to that address after their first claim that misses the 0.5% window is stored as `kind='extra'` (`payments-server.ts:83-101`) and shown under the person's row with a Basescan link.

**Sequence:** anyone looks up a claimant's address (full addresses are served by `/api/line/payee`), finds an unrelated incoming USDC transfer (salary, a friend), and posts it. Up to 5 such rows fill the extras cap, after which real extras are turned away.

**Consequence:** a public link from the person's Pledger row to unrelated money, and wrong copy: the row says "Also received $X, over what was owed" (`LineList.tsx:99`) even when the extra was below what was owed or sent to someone who owed nothing.

**Fix:** store an extra only when the tx came from a Pledger flow (card webhook, or a server-side intent from SI-03), or only show extras to the person; change the copy to "Also received $X, not counted".

### SI-09 LOW: `record_state` holds whichever status ran last

`recordClaims` writes `pledger_claims.record_state = r.state` after each status (`eas.ts:83`). A claim attested "in line" (recorded) whose "paid" attempt failed reads `pending`; a claim whose "paid" attempt never ran (SI-02) reads `recorded`. PoC verified the overwrite. No code reads the column today (grep), so nothing user-facing is wrong yet, but any query or judge reading it gets the wrong answer. Fix: drop the column from use and derive state from `pledger_attestations` per status, or store `paid_record_state` separately.

### SI-10 LOW: self-pay from a second wallet

The "not from self" rule compares only the sending address to the payout address (`app/src/lib/base.ts:58`). A claimant can send their own owed amount from a second wallet: the line says "Paid", "Paid out so far" rises, and the claim is attested "paid", with no helper money moved. Cost to them: gas and their place. This is a limit of the rule, not a bug; note it in the rule copy or the README so totals are not read as "money from helpers".

### SI-11 LOW: browser hold cache lost on reload

`holds.ts:9` keeps "holds I made" in module memory. After a reload, or in a second tab, the helper's own hold shows as "Someone is paying this person now" (`LineList.tsx:89`) and their own split skips those people for up to 10 minutes (`HelpPay.tsx:28`, `allocate/route.ts:59`). Fix: keep the map in `sessionStorage`, or return a hold token from the server and send it with the split.

### SI-12 LOW: extras cap race and window

The 5-per-person cap is checked on a read (`payments-server.ts:87`) taken from `readPayments`, which reads only the newest 200 extras across everyone (`claims-server.ts:129-140`). Concurrent posts, or more than 200 extras overall, let a person exceed 5. Fix: count with `select count(*) where to_address = $1 and kind = 'extra'` inside the same transaction as the insert (SI-05 function).

### SI-13 LOW: read windows and derived views

- `readPayments` and `readClaims` read at most 5000 rows (`claims-server.ts:122`, `145`) with no warning. Past that, the public line drops payments and people show owed after being paid; `recordUsdcPayment` reads per address so its rule stays right, so the two views disagree.
- Home and pledge pages cache for 30 seconds (`app/src/app/page.tsx:10`, `app/src/app/pledges/[slug]/page.tsx:14`) while the line page is live, so right after a payment the line says paid and the home total does not.
- `computeTotals` keys the chart by `shortAddress` (`pledges.ts:313`, `318`); two people whose addresses share the first 6 and last 4 characters are merged in the chart (the headline is unaffected).

### SI-14 LOW: webhook outcomes that end with money on chain and no row

`/api/onramp/webhook` tells Stripe "received" for every non-5xx, non-not-found result (`app/src/app/api/onramp/webhook/route.ts:39-43`): "Sent before this claim was made", the 003 error (409), extras under $1 or past the cap. These are logged only. A card fulfilment that lands after the 10-minute hold, after someone else paid, becomes an extra. Fix: write such outcomes to a `pledger_payment_events` table so they can be followed up without server logs.

## State table: what each page shows in each partial state

| # | State (DB vs chain) | Line page (`/claim/line`) | Help pay | Home and pledge totals | On-chain record |
|---|----------------------|---------------------------|----------|------------------------|-----------------|
| 1 | Claim stored, "in line" attestation pending or missing | "Waiting" | Includes them | Counted in fees claimed | None or pending row |
| 2 | Transfer on Base, no payment row (SI-01, SI-03, SI-04) | "Waiting", full amount owed; Pay button live | Sends the next helper once the hold ends | Not counted | None |
| 3 | Payment row `paid`, attestation never scheduled (SI-02) | "Paid" | Skips them | Counted | None, forever |
| 4 | Payment row `paid`, attestation row `pending` | "Paid" | Skips them | Counted | None; retry blocked after 004 |
| 5 | Two `paid` rows for one person (SI-05) | "Paid" | Skips them | Counted once (capped); feed shows two give-backs | One record after 004, two before |
| 6 | Paid, then a new claim (SI-06) | New place "Paid", old place "Paid $7 of $10" | Sends $3 to them | Unchanged | Old claim says "paid" |
| 7 | `extra` row | Note under first place; owed unchanged | Still includes them | Not counted | None |
| 8 | Active hold | "Someone is paying this person now", outside-pay hidden, Pay button still shown | Skips them unless more than half are held | Unchanged | n/a |
| 9 | Payment sent before the first claim | "Waiting" | Includes them | Not counted | None; no row, log only |
| 10 | Home cache older than the line (SI-13) | Paid | Skips them | Up to 30 s behind | n/a |

## Answers to the questions asked

**Where can two sources of truth disagree?** Chain vs DB: SI-01, SI-03, SI-04, SI-14 and state 9. DB vs attestations: SI-02, SI-05, SI-06, SI-09. DB vs client cache: `PayPanel` and `HelpPay` keep the owed amount from the last line load, but both re-check before sending (`PayPanel.tsx:79`, `HelpPay.tsx:240-246`), so the remaining gap is the window between that check and the wallet confirm, which the hold covers only for the first 10 people (SI-07). DB vs in-memory: holds per IP and rate limits (SI-07, SI-01), and the browser hold map (SI-11).

**Which transitions are not idempotent or can be partly applied?** Payment insert then attest (SI-02: insert succeeds, attest skipped or pending). Slot insert then attest then update then `record_state` (any step can stop; `eas.ts:65-83`). Batch send then per-person record (SI-01, SI-04). Payment recording itself is idempotent per (tx, address) via sql/003's unique index and the 409 path (`payments-server.ts:58-59`, `144-149`); the gap is between different txs (SI-05).

**Can valid calls leave a person "paid" with no counted payment?** Not in the DB: "paid" always comes from `kind='paid'` rows (`claims.ts:371-380`). Two near misses: SI-06 shows a never-paid claim as "Paid" by moving an older payment onto it, and SI-10 lets the claimant fund their own "paid".

**"Owed" after being paid?** Yes: SI-01, SI-03, SI-04 (paid on chain, not recorded) and SI-06 (paid, then a new claim re-spreads it).

**Attested twice?** Before sql/004: yes, by SI-05 (race) or SI-06 (paid again after a new claim). After 004: no, the slot insert blocks the second (PoC verified), at the cost of SI-02.

**A hold that never expires?** No single row, but renewals are unbounded (SI-07).

## Migration order

| DB state | Effect |
|----------|--------|
| Before 003 | One tx can be recorded for one person only. Help pay batches: person 2 onward gets "Batch payments need the 003 update", which Help pay treats as final and drops (SI-01). |
| 003, before 004 | Double attestation possible (SI-05, SI-06). Every attestation race writes two rows; the `update` at `eas.ts:73-82` then updates both. |
| 004 run | Double attestation blocked; pending rows become permanent (SI-02). If the old code already wrote a duplicate (claim, status), the `create unique index` fails, the DB stays in "before 004", and nothing in the app notices. Run the check query in `sql/004` first, every time. |
| Before 005 | No holds (every helper is sent to the same people), wrong amounts are rejected and only logged, so the chain has money the DB never shows. `readPayments` falls back on error codes `PGRST204`, `PGRST205`, `42703`, `42P01` (`claims-server.ts:92-99`, `122-127`). |
| 005 run before 004 | Works: 005 does not depend on 004, and every feature checks its own table or column. The double-attestation window stays open until 004 runs, and any duplicate written in that window makes 004 fail to build (see above). |
| Half of 005 | Each part is detected on its own (holds table vs `kind` column), so either half alone is safe. |
| After 007 plus the planned postgres.js move | `isMissingSchema` and the `23505` checks depend on PostgREST error shapes (`docs/limited-role.md`). If the rewrite misses them, an extra insert before 005 becomes a 500 instead of a reject, and the attestation slot check in `eas.ts:71` changes meaning. Test those two branches first, as the doc says. |

## Recommended order of fixes

1. SI-01: make 429 and the 003 answer retryable in `HelpPay` (one line), and raise or re-key the verify limit. Smallest change, biggest real-money effect, and it was introduced today.
2. SI-03 interim: persist sent tx hashes in `localStorage` and replay on load.
3. SI-02: a retry route for `pending` attestation rows that updates in place; stop `.catch(() => [])` hiding the trigger.
4. Run sql/004 (after its check query) before any more real payments.
5. SI-05 and SI-12: one Postgres function that records a payment under a per-address lock.
6. SI-06 and SI-07: rule decisions for Erin (claim-order filling; hold renew cap).

## Coverage notes

Verified by PoC (scratch vitest, fake DB): SI-02 (retry blocked), SI-05, SI-06, SI-09, and the before-004 double attestation. Verified by code trace only: SI-01, SI-03, SI-04, SI-07, SI-08, SI-10 to SI-14. Not checked: real Postgres locking behaviour, real EIP-5792 wallet status codes for partial batches (SI-04 assumes a wallet that runs calls separately), how the host sets `x-forwarded-for`, and the function time limit for `after()` on the deployed plan. `.env` files were not read.
