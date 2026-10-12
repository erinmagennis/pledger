import { describe, expect, it } from "vitest";
import { buildOnrampParams, clientIp, friendlyStripeError, fulfilledTransfer, signStripePayload, UNSUPPORTED_MSG, verifyStripeSignature } from "@/lib/onramp";

const SECRET = "whsec_test_secret";
const NOW = 1_760_000_000;
const BODY = JSON.stringify({ id: "evt_1", type: "crypto.onramp_session.updated" });

describe("Stripe webhook signature", () => {
  it("accepts a valid signature", () => {
    expect(verifyStripeSignature(BODY, signStripePayload(BODY, SECRET, NOW), SECRET, NOW)).toBe(true);
  });

  it("accepts when one of several v1 signatures matches (secret rotation)", () => {
    const good = signStripePayload(BODY, SECRET, NOW).split(",")[1];
    expect(verifyStripeSignature(BODY, `t=${NOW},v1=${"0".repeat(64)},${good}`, SECRET, NOW)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const h = signStripePayload(BODY, SECRET, NOW);
    expect(verifyStripeSignature(BODY.replace("evt_1", "evt_2"), h, SECRET, NOW)).toBe(false);
  });

  it("rejects a tampered timestamp and a wrong secret", () => {
    const sig = signStripePayload(BODY, SECRET, NOW).split(",")[1];
    expect(verifyStripeSignature(BODY, `t=${NOW + 1},${sig}`, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, signStripePayload(BODY, "whsec_other", NOW), SECRET, NOW)).toBe(false);
  });

  it("rejects an old timestamp outside the 5 minute window", () => {
    const old = NOW - 301;
    expect(verifyStripeSignature(BODY, signStripePayload(BODY, SECRET, old), SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, signStripePayload(BODY, SECRET, NOW - 299), SECRET, NOW)).toBe(true);
  });

  it("rejects missing or malformed headers", () => {
    expect(verifyStripeSignature(BODY, null, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, "garbage", SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(BODY, `t=${NOW}`, SECRET, NOW)).toBe(false);
  });
});

describe("onramp session params", () => {
  const ADDR = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

  it("locks the wallet to the claimant on Base, USDC only", () => {
    const p = buildOnrampParams({ address: ADDR, remainingCents: 1250, ip: "8.8.8.8" });
    expect(p.get("wallet_addresses[base_network]")).toBe(ADDR);
    expect(p.get("lock_wallet_address")).toBe("true");
    expect(p.getAll("destination_networks[]")).toEqual(["base"]);
    expect(p.get("destination_network")).toBe("base");
    expect(p.getAll("destination_currencies[]")).toEqual(["usdc"]);
    expect(p.get("destination_currency")).toBe("usdc");
    expect(p.get("destination_amount")).toBe("12.50");
    expect(p.get("customer_ip_address")).toBe("8.8.8.8");
    expect(p.has("source_amount")).toBe(false);
  });

  it("omits amount and ip when not known", () => {
    const p = buildOnrampParams({ address: ADDR, remainingCents: 0, ip: null });
    expect(p.has("destination_amount")).toBe(false);
    expect(p.has("customer_ip_address")).toBe(false);
    expect(p.get("lock_wallet_address")).toBe("true");
  });

  it("reads the first forwarded ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBeNull();
  });

  it("maps region errors to a friendly message", () => {
    expect(friendlyStripeError({ error: { code: "crypto_onramp_unsupportable_customer" } })).toBe(UNSUPPORTED_MSG);
    expect(friendlyStripeError({ error: { code: "crypto_onramp_unsupported_country" } })).toBe(UNSUPPORTED_MSG);
    expect(friendlyStripeError({ error: { code: "other" } })).toBe("Could not start a card payment");
  });
});

describe("fulfilled onramp event", () => {
  const TX = "0x" + "ab".repeat(32);
  const ADDR = "0xAbCdEfabcdefabcdefabcdefabcdefabcdefABCD";
  const ev = (status: string, td: Record<string, unknown> = {}) => ({
    type: "crypto.onramp_session.updated",
    data: { object: { object: "crypto.onramp_session", status, transaction_details: { destination_network: "base", transaction_id: TX, wallet_address: ADDR, ...td } } },
  });

  it("returns tx and lowercased recipient on fulfillment_complete", () => {
    expect(fulfilledTransfer(ev("fulfillment_complete"))).toEqual({ txHash: TX, to: ADDR.toLowerCase() });
  });

  it("falls back to wallet_addresses.base_network", () => {
    expect(fulfilledTransfer(ev("fulfillment_complete", { wallet_address: null, wallet_addresses: { base_network: ADDR } }))?.to).toBe(ADDR.toLowerCase());
  });

  it("ignores other statuses, networks, events and missing tx", () => {
    expect(fulfilledTransfer(ev("fulfillment_processing"))).toBeNull();
    expect(fulfilledTransfer(ev("fulfillment_complete", { destination_network: "ethereum" }))).toBeNull();
    expect(fulfilledTransfer(ev("fulfillment_complete", { transaction_id: null }))).toBeNull();
    expect(fulfilledTransfer({ ...ev("fulfillment_complete"), type: "payment_intent.succeeded" })).toBeNull();
  });
});
