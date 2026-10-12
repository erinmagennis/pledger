# Card payments (Stripe crypto onramp)

A supporter pays someone in the line by card. Stripe sells USDC on Base and sends it straight to the claimant's payout wallet. Pledger never holds the money.

## How it works

1. `POST /api/onramp/session` with `{ payeeId }`. The server looks up the full payout address, works out everything this person is still owed across all their places (any `group` is ignored, because the payment rule checks a transfer against the full remaining) and mints a Stripe onramp session with the wallet locked:
   - `wallet_addresses[base_network]=<address>` (Stripe names the Base wallet field `base_network`, see the CryptoOnrampSession object reference)
   - `lock_wallet_address=true`
   - `destination_networks[]=base`, `destination_network=base`
   - `destination_currencies[]=usdc`, `destination_currency=usdc`
   - `destination_amount=<remaining in USD>` when known (if the person owes nothing right now, the route answers 400 "Nothing is owed to this person right now" and mints no session)
   - `customer_ip_address` from `x-forwarded-for`
   It returns `{ clientSecret, redirectUrl }` only.
2. The Pay panel shows "Pay by card", with the line "Keep the amount as shown. A different amount cannot be matched to this person." It mounts Stripe's embedded onramp. On screens under 600px wide, or if the widget fails to load, it opens `redirectUrl` (a `crypto.link.com?session_hash=...` page hosted by Stripe/Link) in a new tab instead.
3. Stripe calls `POST /api/onramp/webhook` with `crypto.onramp_session.updated`. On `fulfillment_complete` the route reads `transaction_details.transaction_id` (the Base tx hash), checks it on Base and records it the same way as a pasted payment. Repeat deliveries are ignored.

USDC on Base is supported for US customers (not EU). Others see "Card payments to Base are available in the US for now."

## Card to Tempo (demo)

**Status (12 Oct 2026): off.** Stripe's sandbox rejects USDC on Tempo (`crypto_onramp_invalid_destination_currency_and_network_pair`), so the card step is hidden (`TEMPO_CARD_ENABLED = false` in `TryIt.tsx`). The code below stays ready for when Stripe lists a stablecoin on Tempo.

The demo match pool page shows the whole route: card, then USDC on Tempo, then a matched donation. Stripe cannot call a contract; it only delivers tokens to a wallet. So the card buys USDC into the visitor's throwaway test wallet, and the existing "Try it" flow (or a connected wallet) then calls `donate` on the MatchPool from that wallet.

1. "Try it" makes the test wallet. Once it exists, the card shows "Fund this test wallet by card" (hidden without `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, "Test mode" chip on `pk_test_...`).
**Test key only.** The Tempo route runs only when `STRIPE_SECRET_KEY` starts with `sk_test_`. With a live key it answers 503 "Card to Tempo is a sandbox demo only", so real card money can never be sent into a demo wallet.

2. `POST /api/onramp/session` with `{ network: "tempo", address, amountUsd? }`. The address must be a valid EVM address string; the amount must be a number from $1 to $500 and defaults to $20 when left out or null (the page sends $20). No database lookup. Params:
   - `wallet_addresses[tempo]=<address>` (see the key note below)
   - `lock_wallet_address=true`
   - `destination_networks[]=tempo`, `destination_network=tempo`
   - `destination_currencies[]=usdc`, `destination_currency=usdc`
   - `destination_amount=<amountUsd>`
   - `customer_ip_address` from `x-forwarded-for`
   It returns `{ clientSecret, redirectUrl }`, like the Base route. The embedded widget, the narrow-screen redirect and the widget-failure fallback are the same component as "Pay by card" (`src/components/pay/StripeOnramp.tsx`).
3. On `fulfillment_complete` the card shows "Card step done." The webhook ignores Tempo deliveries (`fulfilledTransfer` is Base only, and also needs the Base wallet field, so a delivery with no `destination_network` is ignored, not retried), so nothing is recorded as an Artizen payment.

**Wallet key: unverified.** Stripe's API lists `tempo` in the `destination_network(s)` enum, but the CryptoOnrampSession reference does not name the Tempo field in `wallet_addresses` yet. The code guesses `tempo`. If session creation fails with an invalid `wallet_addresses` parameter, change `WALLET_KEYS.tempo` in `app/src/lib/onramp.ts` to `tempo_network` (the Base pattern) and update the Tempo test in `app/test/onramp.test.ts`. One sandbox session is enough to confirm which key Stripe accepts.

**What sandbox does:** mints a real sandbox session locked to the test wallet on Tempo, runs Stripe's card and identity screens with the test values below, and reports `fulfillment_complete`.

**What sandbox does not do:** no real USDC arrives in the test wallet, and the pool runs on Tempo testnet with its own test token, not USDC. The test money for the donation still comes from the faucet (`/api/demo/fund`). The page says so: "Sandbox: the card step is a demo. Test money for the donation still comes from the faucet."

## Env vars

| Name | Where |
| --- | --- |
| `STRIPE_SECRET_KEY` | server. Missing = session route returns 503 "Card payments are not connected yet" |
| `STRIPE_WEBHOOK_SECRET` | server. Signing secret of the webhook endpoint |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | client. Missing = "Pay by card" is hidden. `pk_test_...` shows a "Test mode" chip |

Setup: get onramp access in the Stripe Dashboard, add the site domain on the onramp onboarding page, set Public business name and Business website (or sessions fail with `crypto_onramp_merchant_not_properly_setup`), then add a webhook endpoint for `crypto.onramp_session.updated` pointing at `/api/onramp/webhook`.

## Sandbox test values

- OTP code: `000000`
- SSN: `000000000`
- Address line 1: `address_full_match`
- Card: `4242 4242 4242 4242`, any future date, any CVC

Sandbox amounts are overridden by Stripe's preset limits. In test mode no real USDC moves, so the webhook will not find a Base mainnet transfer and the claim stays unpaid. That is expected.

Local webhook testing: `stripe listen --forward-to localhost:3000/api/onramp/webhook` prints a `whsec_...` secret to use as `STRIPE_WEBHOOK_SECRET`.
