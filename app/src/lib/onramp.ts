// Stripe crypto onramp helpers. Pure functions only (no fetch, no env) so they are easy to test.
// Docs: https://docs.stripe.com/api/crypto/onramp_sessions/create
//       https://docs.stripe.com/webhooks#verify-manually
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Network choice. Stripe's API lists `base` and `tempo` in the destination_network(s) enum, and the
 * CryptoOnrampSession object names the Base wallet field `wallet_addresses.base_network`
 * (not `base`). USDC on Base is supported for US customers.
 */
export type OnrampNetwork = "base" | "tempo";

/**
 * `wallet_addresses` key per network. `base_network` follows the CryptoOnrampSession reference.
 * `tempo` is a guess: the reference does not list the Tempo key yet. If Stripe rejects it,
 * try `tempo_network` here (see docs/card-payments.md, "Card to Tempo").
 */
export const WALLET_KEYS: Record<OnrampNetwork, string> = { base: "base_network", tempo: "tempo" };

// Base stays the default for claims; these names are kept for existing imports.
export const ONRAMP_NETWORK = "base" as const;
export const ONRAMP_WALLET_KEY = "base_network" as const;
export const ONRAMP_CURRENCY = "usdc" as const;

export const UNSUPPORTED_MSG = "Card payments to Base are available in the US for now.";
export const NOT_CONNECTED_MSG = "Card payments are not connected yet";
export const TEMPO_UNSUPPORTED_MSG = "Card payments to Tempo are not available where you are yet.";

/** Form params for POST /v1/crypto/onramp_sessions. Locks the wallet, the network and USDC. */
export function buildOnrampParams(args: { address: string; remainingCents?: number; ip?: string | null; network?: OnrampNetwork }): URLSearchParams {
  const network = args.network ?? ONRAMP_NETWORK;
  const p = new URLSearchParams();
  p.set(`wallet_addresses[${WALLET_KEYS[network]}]`, args.address);
  p.set("lock_wallet_address", "true");
  p.append("destination_networks[]", network);
  p.set("destination_network", network);
  p.append("destination_currencies[]", ONRAMP_CURRENCY);
  p.set("destination_currency", ONRAMP_CURRENCY);
  if (args.remainingCents && args.remainingCents > 0) p.set("destination_amount", (args.remainingCents / 100).toFixed(2));
  if (args.ip) p.set("customer_ip_address", args.ip);
  return p;
}

export const TEMPO_DEFAULT_USD = 20;
export const TEMPO_MAX_USD = 500;

/**
 * Body for the demo route `{ network: "tempo", address, amountUsd? }`: card buys USDC into a Tempo wallet.
 * Stripe cannot call the pool contract, so the donation itself still happens from that wallet.
 */
export function parseTempoBody(body: unknown): { address: string; amountCents: number } | { error: string } {
  const b = (body ?? {}) as { network?: unknown; address?: unknown; amountUsd?: unknown };
  if (b.network !== "tempo") return { error: "Send network: tempo" };
  const address = String(b.address ?? "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { error: "Send a valid wallet address" };
  const usd = b.amountUsd === undefined ? TEMPO_DEFAULT_USD : Number(b.amountUsd);
  if (!Number.isFinite(usd) || usd < 1 || usd > TEMPO_MAX_USD) return { error: `Amount must be $1 to $${TEMPO_MAX_USD}` };
  return { address, amountCents: Math.round(usd * 100) };
}

/** First address in x-forwarded-for, else x-real-ip. */
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || headers.get("x-real-ip")?.trim() || null;
}

/** Map a Stripe error body to a short message for the payer. */
export function friendlyStripeError(body: unknown, network: OnrampNetwork = ONRAMP_NETWORK): string {
  const code = (body as { error?: { code?: string } } | null)?.error?.code ?? "";
  if (code === "crypto_onramp_unsupportable_customer" || code === "crypto_onramp_unsupported_country") return network === "tempo" ? TEMPO_UNSUPPORTED_MSG : UNSUPPORTED_MSG;
  if (code === "crypto_onramp_disabled") return "Card payments are paused right now. Try again later.";
  return "Could not start a card payment";
}

export const SIGNATURE_TOLERANCE_S = 300;

/**
 * Verify a Stripe-Signature header ("t=...,v1=...[,v1=...]") against the raw body.
 * Signed payload is `${t}.${body}`, HMAC-SHA256 with the endpoint secret, hex encoded.
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowS = Math.floor(Date.now() / 1000), toleranceS = SIGNATURE_TOLERANCE_S): boolean {
  if (!header || !secret) return false;
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = Number(v);
    else if (k === "v1") sigs.push(v);
  }
  if (t === null || !Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(nowS - t) > toleranceS) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"), "utf8");
  return sigs.some((s) => {
    const got = Buffer.from(s, "utf8");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** Test helper and reference: build a valid header for a body. */
export function signStripePayload(rawBody: string, secret: string, t: number): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}

type OnrampSessionLike = {
  object?: string;
  status?: string;
  transaction_details?: {
    transaction_id?: string | null;
    destination_network?: string | null;
    wallet_address?: string | null;
    wallet_addresses?: Record<string, unknown> | null;
  };
};

/**
 * From a webhook event, the delivered Base tx and recipient, or null if there is nothing to record.
 * Base only: Tempo deliveries (the demo pool route) are not Artizen payments, so they are ignored.
 */
export function fulfilledTransfer(event: unknown): { txHash: string; to: string } | null {
  const e = event as { type?: string; data?: { object?: OnrampSessionLike } } | null;
  if (e?.type !== "crypto.onramp_session.updated") return null;
  const s = e.data?.object;
  if (!s || s.status !== "fulfillment_complete") return null;
  const td = s.transaction_details ?? {};
  if (td.destination_network && td.destination_network !== ONRAMP_NETWORK) return null;
  const tx = String(td.transaction_id ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(tx)) return null;
  const to = String(td.wallet_address ?? td.wallet_addresses?.[ONRAMP_WALLET_KEY] ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(to)) return null;
  return { txHash: tx, to };
}
