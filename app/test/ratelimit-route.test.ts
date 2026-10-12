import { describe, expect, it, vi } from "vitest";
import { resetLimits } from "@/lib/ratelimit";

vi.mock("@/lib/supabase", () => ({ getSupabase: () => null, DB_MISSING: { error: "Database not connected yet" } }));
const { POST } = await import("@/app/api/claims/verify/route");

const call = (ip: string) =>
  POST(new Request("http://x/api/claims/verify", { method: "POST", headers: { "x-forwarded-for": ip }, body: "not a form" }));

describe("429 shape on /api/claims/verify", () => {
  it("lets 20 requests through per IP, then answers 429 with the plain message", async () => {
    resetLimits();
    for (let i = 0; i < 20; i++) expect((await call("5.5.5.5")).status).toBe(400);
    const res = await call("5.5.5.5");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests. Try again in a few minutes." });
    expect((await call("6.6.6.6")).status).toBe(400);
  });
});
