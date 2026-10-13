import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "./fake-db";
import { DOWN_FOR_MS, FAUCET_DOWN_MSG, PROBE_EVERY_MS, faucetDown, faucetStatus, isFaucetError, noteFaucet, resetFaucetStatus } from "@/lib/faucet-status";

let current: FakeDb | null = null;
vi.mock("@/lib/supabase", () => ({ getSupabase: () => current?.db ?? null, DB_MISSING: { error: "Database not connected yet" } }));
vi.mock("@/lib/tempo", () => ({
  TEMPO_RPC: "http://tempo.test",
  alphaBalance: async () => 5_000_000n,
  usd: (n: bigint) => String(n),
}));
const { createPledge } = await import("@/lib/selfserve-server");
const { POST: fundPOST } = await import("@/app/api/demo/fund/route");

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const good = { name: "Spring match", poolUsd: "250", ratio: "1:1", capUsd: "25", lockUntil: "2026-11-30", recipient: "" };
const deployed = {
  address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  sponsor: "0x2222222222222222222222222222222222222222" as `0x${string}`,
  deployTx: "0xd" as `0x${string}`,
  approveTx: "0xa" as `0x${string}`,
  depositTx: "0xe" as `0x${string}`,
  deployBlock: 1,
  recipient: "0x3333333333333333333333333333333333333333" as `0x${string}`,
};
const faucetBroken = vi.fn(async () => {
  throw new Error("The Tempo test faucet answered with status 500.");
});

let n = 0;
const addr = () => `0x${(++n).toString(16).padStart(40, "0")}`;
const fund = () =>
  fundPOST(new Request("http://x/api/demo/fund", { method: "POST", headers: { "x-forwarded-for": `8.8.8.${n}` }, body: JSON.stringify({ address: addr() }) }) as never);

beforeEach(() => {
  resetFaucetStatus();
  current = fakeDb({});
  faucetBroken.mockClear();
});

describe("faucet status", () => {
  it("only counts real faucet failures, not a pool too big for one round", () => {
    expect(isFaucetError("The Tempo test faucet answered with status 503.")).toBe(true);
    expect(isFaucetError("The Tempo test faucet said: rate limited.")).toBe(true);
    expect(isFaucetError("The Tempo test faucet did not send enough test money for this pool. Try a smaller amount.")).toBe(false);
  });

  it("is down for two minutes after a failure, then not", () => {
    noteFaucet(false, NOW);
    expect(faucetDown(NOW + DOWN_FOR_MS - 1)).toBe(true);
    expect(faucetDown(NOW + DOWN_FOR_MS)).toBe(false);
    noteFaucet(true, NOW + 10);
    expect(faucetDown(NOW + 20)).toBe(false);
  });

  it("probes at most once a minute and shares one probe", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 200 }));
    const [a, b] = await Promise.all([faucetStatus("http://rpc", f as never, NOW), faucetStatus("http://rpc", f as never, NOW)]);
    expect(a).toEqual({ down: true });
    expect(b).toEqual({ down: true });
    await faucetStatus("http://rpc", f as never, NOW + PROBE_EVERY_MS - 1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("uses a recent real result without probing", async () => {
    noteFaucet(true, NOW);
    const f = vi.fn();
    expect(await faucetStatus("http://rpc", f as never, NOW + 1000)).toEqual({ down: false });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("createPledge when the faucet is down", () => {
  it("answers 503 with the calm message, then skips the chain on the next try", async () => {
    const r = await createPledge(good, "1.1.1.1", faucetBroken, NOW);
    expect(r).toEqual({ status: 503, body: { ok: false, faucetDown: true, error: FAUCET_DOWN_MSG } });
    const again = await createPledge(good, "1.1.1.1", faucetBroken, NOW + 1000);
    expect(again.status).toBe(503);
    expect(faucetBroken).toHaveBeenCalledOnce();
  });

  it("a working deploy clears it", async () => {
    noteFaucet(false, NOW - DOWN_FOR_MS - 1);
    const r = await createPledge(good, "1.1.1.1", async () => deployed, NOW);
    expect(r.status).toBe(200);
    expect(faucetDown(NOW + 1)).toBe(false);
  });
});

describe("demo fund when the faucet is down", () => {
  it("answers 503 faucetDown on a faucet error, then does not call the faucet again", async () => {
    const f = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", f);
    const res = await fund();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, faucetDown: true, error: FAUCET_DOWN_MSG });
    const res2 = await fund();
    expect(res2.status).toBe(503);
    expect(f).toHaveBeenCalledOnce();
  });
});
