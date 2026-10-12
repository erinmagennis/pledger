import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake line: one person with two places, $10 and $15 still owed, plus someone else.
const PID = "11111111-2222-3333-4444-555555555555";
const PAYOUT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({}), DB_MISSING: { error: "Database not connected yet" } }));
vi.mock("@/lib/claims-server", () => ({
  payoutAddressFor: async () => ({ address: PAYOUT }),
  loadLine: async () => [
    { pid: PID, group: 1, feeCents: 1000, paidCents: 0 },
    { pid: PID, group: 2, feeCents: 2000, paidCents: 500 },
    { pid: "other", group: 3, feeCents: 9900, paidCents: 0 },
  ],
}));
const { POST } = await import("@/app/api/onramp/session/route");

let sent: URLSearchParams | null = null;
beforeEach(() => {
  sent = null;
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent = new URLSearchParams(String(init.body));
    return new Response(JSON.stringify({ client_secret: "cos_secret", redirect_url: "https://crypto.link.com/x" }), { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const post = (body: unknown) => POST(new Request("http://x/api/onramp/session", { method: "POST", body: JSON.stringify(body) }));

describe("onramp session route", () => {
  it("asks for the person's full remaining on Base, ignoring group", async () => {
    const res = await post({ payeeId: PID, group: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ clientSecret: "cos_secret", redirectUrl: "https://crypto.link.com/x" });
    expect(sent?.get("wallet_addresses[base_network]")).toBe(PAYOUT);
    expect(sent?.get("destination_amount")).toBe("25.00");
  });

  it("mints a Tempo session for a test wallet with the amount set", async () => {
    const res = await post({ network: "tempo", address: PAYOUT, amountUsd: 20 });
    expect(res.status).toBe(200);
    expect(sent?.get("destination_network")).toBe("tempo");
    expect(sent?.get("destination_amount")).toBe("20.00");
    expect(sent?.has("wallet_addresses[base_network]")).toBe(false);
  });

  it("rejects a bad Tempo address or amount before calling Stripe", async () => {
    expect((await post({ network: "tempo", address: "0x12" })).status).toBe(400);
    expect((await post({ network: "tempo", address: PAYOUT, amountUsd: 900 })).status).toBe(400);
    expect(sent).toBeNull();
  });
});
