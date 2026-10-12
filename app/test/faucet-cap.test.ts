import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "./fake-db";

let current: FakeDb | null = null;
vi.mock("@/lib/supabase", () => ({ getSupabase: () => current?.db ?? null, DB_MISSING: { error: "Database not connected yet" } }));
vi.mock("@/lib/tempo", () => ({
  TEMPO_RPC: "http://tempo.test",
  alphaBalance: async () => 5_000_000n,
  usd: (n: bigint) => String(n),
}));
const { POST } = await import("@/app/api/demo/fund/route");

let n = 0;
const addr = () => `0x${(++n).toString(16).padStart(40, "0")}`;
let ipN = 0;
function fund(ip = `9.9.9.${++ipN}`) {
  return POST(new Request("http://x/api/demo/fund", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: JSON.stringify({ address: addr() }),
  }) as never);
}

beforeEach(() => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ result: ["0xtx"] }), { status: 200 }));
});

describe("demo faucet global cap (sql/006)", () => {
  it("answers 429 once 40 fundings landed in the last hour", async () => {
    const recent = new Date().toISOString();
    current = fakeDb({ pledger_faucet_log: Array.from({ length: 40 }, () => ({ created_at: recent, ip_hash: "h", address: "0x" })) });
    const res = await fund();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: "The demo is busy right now. Try again in a few minutes." });
  });

  it("funds at 39, and logs a hashed IP, never the raw one", async () => {
    const recent = new Date().toISOString();
    current = fakeDb({ pledger_faucet_log: Array.from({ length: 39 }, () => ({ created_at: recent, ip_hash: "h", address: "0x" })) });
    const res = await fund("203.0.113.7");
    expect(res.status).toBe(200);
    const log = current.tables.pledger_faucet_log!;
    expect(log).toHaveLength(40);
    const row = log[39]!;
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
    expect(row.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect((await fund()).status).toBe(429);
  });

  it("ignores fundings older than an hour", async () => {
    const old = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    current = fakeDb({ pledger_faucet_log: Array.from({ length: 50 }, () => ({ created_at: old, ip_hash: "h", address: "0x" })) });
    expect((await fund()).status).toBe(200);
  });

  it("before 006 runs: skips the global cap and still funds", async () => {
    current = fakeDb({}, {}, { missing: ["pledger_faucet_log"] });
    const res = await fund();
    expect(res.status).toBe(200);
    expect(current.tables.pledger_faucet_log).toEqual([]);
  });

  it("with no database: still funds under the in-memory limit", async () => {
    current = null;
    expect((await fund("7.7.7.7")).status).toBe(200);
  });

  it("keeps the per-IP limit in memory: 4th wallet from one IP gets 429", async () => {
    current = null;
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await fund("8.8.8.8")).status);
    expect(codes).toEqual([200, 200, 200, 429]);
  });
});
