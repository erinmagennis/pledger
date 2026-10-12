import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// One person who owes nothing (paid, a forgiven entry included) and one who owes $10.
const PAID = "11111111-2222-3333-4444-555555555555";
const OWES = "11111111-2222-3333-4444-666666666666";
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({}), DB_MISSING: { error: "Database not connected yet" } }));
vi.mock("@/lib/claims-server", () => ({
  payoutAddressFor: async () => ({ address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
  loadLine: async () => [
    { pid: PAID, group: 2, feeCents: 1000, paidCents: 1000, status: "paid" },
    { pid: PAID, group: 1, feeCents: 500, paidCents: 495, status: "paid" },
    { pid: OWES, group: 2, feeCents: 1000, paidCents: 0, status: "waiting" },
  ],
}));
const { POST } = await import("@/app/api/onramp/session/route");

let calls = 0;
beforeEach(() => {
  calls = 0;
  vi.stubGlobal("fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ client_secret: "cos_secret", redirect_url: null }), { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const post = (body: unknown) => POST(new Request("http://x/api/onramp/session", { method: "POST", headers: { "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify(body) }));
const TEMPO = { network: "tempo", address: "0x1111111111111111111111111111111111111111" };

describe("onramp session rules", () => {
  it("refuses card to Tempo unless the Stripe key is a test key", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_fake");
    const res = await post(TEMPO);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Card to Tempo is a sandbox demo only" });
    expect(calls).toBe(0);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    expect((await post(TEMPO)).status).toBe(200);
  });

  it("refuses a Base card session when nothing is owed, and mints one when something is", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_fake");
    const res = await post({ payeeId: PAID });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Nothing is owed to this person right now" });
    expect(calls).toBe(0);
    expect((await post({ payeeId: OWES })).status).toBe(200);
  });

  it("answers 400 to a JSON null body", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    const res = await post(null);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Send a JSON object" });
  });
});
