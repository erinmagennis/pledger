# Card payments (Stripe crypto onramp)

A supporter pays someone in the line by card. Stripe sells USDC on Base and sends it straight to the claimant's payout wallet. Pledger never holds the money.

## How it works

1. `POST /api/onramp/session` with `{ payeeId, group? }`. The server looks up the full payout address, works out what is still owed and mints a Stripe onramp session with the wallet locked:
   - `wallet_addresses[base_network]=<address>` (Stripe names the Base wallet field `base_network`, see the CryptoOnrampSession object reference)
   - `lock_wallet_address=true`
   - `destination_networks[]=base`, `destination_network=base`
   - `destination_currencies[]=usdc`, `destination_currency=usdc`
   - `destination_amount=<remaining in USD>` when known
   - `customer_ip_address` from `x-forwarded-for`
   It returns `{ clientSecret, redirectUrl }` only.
2. The Pay panel shows "Pay by card". It mounts Stripe's embedded onramp. On screens under 600px wide, or if the widget fails to load, it opens `redirectUrl` (a `crypto.link.com?session_hash=...` page hosted by Stripe/Link) in a new tab instead.
3. Stripe calls `POST /api/onramp/webhook` with `crypto.onramp_session.updated`. On `fulfillment_complete` the route reads `transaction_details.transaction_id` (the Base tx hash), checks it on Base and records it the same way as a pasted payment. Repeat deliveries are ignored.

USDC on Base is supported for US customers (not EU). Others see "Card payments to Base are available in the US for now."

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
