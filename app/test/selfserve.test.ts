import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "./fake-db";
import {
  DEMO_RECIPIENT,
  bpsToRatio,
  capCheck,
  fromRow,
  makeSlug,
  ratioToBps,
  toRow,
  toUnits,
  validatePledgeInput,
  type PledgeInput,
} from "@/lib/selfserve";
import { EXAMPLE_POOL, feed, howSteps, poolNumbers, type LiveNums } from "@/lib/poolview";

let current: FakeDb | null = null;
vi.mock("@/lib/supabase", () => ({ getSupabase: () => current?.db ?? null, DB_MISSING: { error: "Database not connected yet" } }));
const { createPledge, getSelfServe, TABLE } = await import("@/lib/selfserve-server");

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const nowSec = NOW / 1000;
const good = { name: "Spring match", poolUsd: "250", ratio: "1:1", capUsd: "25", lockUntil: "2026-11-30", recipient: "" };
const POOL = "0x1111111111111111111111111111111111111111";

const deployOk = vi.fn(async (_input: PledgeInput, recipient: `0x${string}`) => ({
  address: POOL as `0x${string}`,
  sponsor: "0x2222222222222222222222222222222222222222" as `0x${string}`,
  deployTx: "0xd" as `0x${string}`,
  approveTx: "0xa" as `0x${string}`,
  depositTx: "0xe" as `0x${string}`,
  deployBlock: 123,
  recipient,
}));

beforeEach(() => {
  current = fakeDb({});
  deployOk.mockClear();
});

describe("validatePledgeInput", () => {
  it("accepts a good form and trims the name", () => {
    const v = validatePledgeInput({ ...good, name: "  Spring   match " }, nowSec);
    expect(v).toEqual({
      ok: true,
      value: { name: "Spring match", poolUsd: 250, ratio: "1:1", capUsd: 25, lockUntil: Date.UTC(2026, 10, 30, 23, 59, 59) / 1000, recipient: null },
    });
  });

  it("caps the pool at $500 test money and rejects bad numbers", () => {
    expect(validatePledgeInput({ ...good, poolUsd: "500.01" }, nowSec).ok).toBe(false);
    expect(validatePledgeInput({ ...good, poolUsd: "abc" }, nowSec).ok).toBe(false);
    expect(validatePledgeInput({ ...good, poolUsd: "0" }, nowSec).ok).toBe(false);
    expect(validatePledgeInput({ ...good, poolUsd: "1.005" }, nowSec).ok).toBe(false);
    expect(validatePledgeInput({ ...good, poolUsd: "500", capUsd: "500" }, nowSec).ok).toBe(true);
  });

  it("keeps the cap per donor within the pool", () => {
    const v = validatePledgeInput({ ...good, poolUsd: "20", capUsd: "25" }, nowSec);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.capUsd).toMatch(/more than the whole pool/);
  });

  it("needs a lock date in the future and within a year", () => {
    expect(validatePledgeInput({ ...good, lockUntil: "2026-10-01" }, nowSec).ok).toBe(false);
    expect(validatePledgeInput({ ...good, lockUntil: "2027-10-14" }, nowSec).ok).toBe(false);
    expect(validatePledgeInput({ ...good, lockUntil: "2027-10-12" }, nowSec).ok).toBe(true);
    expect(validatePledgeInput({ ...good, lockUntil: "soon" }, nowSec).ok).toBe(false);
  });

  it("checks ratio, name and recipient", () => {
    expect(validatePledgeInput({ ...good, ratio: "10:1" }, nowSec).ok).toBe(false);
    expect(validatePledgeInput({ ...good, name: "ab" }, nowSec).ok).toBe(false);
    expect(validatePledgeInput({ ...good, name: "<script>" }, nowSec).ok).toBe(false);
    expect(validatePledgeInput({ ...good, recipient: "0x123" }, nowSec).ok).toBe(false);
    expect(validatePledgeInput({ ...good, recipient: "0x" + "0".repeat(40) }, nowSec).ok).toBe(false);
    const own = validatePledgeInput({ ...good, recipient: " " + POOL + " " }, nowSec);
    expect(own.ok && own.value.recipient).toBe(POOL);
  });
});

describe("ratios, units, slugs, rows", () => {
  it("maps ratios to basis points and back", () => {
    expect(ratioToBps("1:1")).toBe(10_000);
    expect(ratioToBps("2:1")).toBe(20_000);
    expect(ratioToBps("1:2")).toBe(5_000);
    expect(bpsToRatio(30_000)).toBe("3:1");
    expect(bpsToRatio(5_000)).toBe("1:2");
  });

  it("turns dollars into 6-decimal units exactly", () => {
    expect(toUnits(500)).toBe(500_000_000n);
    expect(toUnits(12.5)).toBe(12_500_000n);
    expect(toUnits(0.07)).toBe(70_000n);
  });

  it("makes a readable slug ending in the pool address", () => {
    expect(makeSlug("Riverside Tool Library match!", "0x3F9A2C0000000000000000000000000000000000")).toBe("riverside-tool-library-match-3f9a2c");
    expect(makeSlug("***", POOL)).toBe("pledge-111111");
    expect(makeSlug("a".repeat(80), POOL).length).toBeLessThanOrEqual(47);
  });

  it("round-trips a row without the IP hash reaching the page config", () => {
    const v = validatePledgeInput(good, nowSec);
    if (!v.ok) throw new Error("bad fixture");
    const row = toRow(v.value, { address: POOL, sponsor: "0xs", deployTx: "0xd", depositTx: "0xe", deployBlock: 5, recipient: DEMO_RECIPIENT }, "hash");
    expect(row).toMatchObject({ slug: "spring-match-111111", pool_usd: 250, match_bps: 10_000, cap_usd: 25, recipient_is_demo: true, ip_hash: "hash" });
    const cfg = fromRow(row);
    expect(cfg).toMatchObject({ slug: "spring-match-111111", address: POOL, poolUsd: 250, matchBps: 10_000, capUsd: 25, recipientLabel: "Test project", deployBlock: 5 });
    expect(cfg.lockUntil).toBe(v.value.lockUntil);
    expect(JSON.stringify(cfg)).not.toContain("hash");
  });
});

describe("capCheck", () => {
  it("allows 3 per visitor and 40 overall a day", () => {
    expect(capCheck(2, 39)).toEqual({ ok: true });
    expect(capCheck(3, 0)).toMatchObject({ ok: false, error: expect.stringMatching(/3 test pledges a day/) });
    expect(capCheck(0, 40)).toMatchObject({ ok: false, error: expect.stringMatching(/full for today/) });
  });
});

describe("createPledge", () => {
  it("deploys, stores a row with a hashed IP and returns the link", async () => {
    const r = await createPledge(good, "203.0.113.9", deployOk, NOW);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, slug: "spring-match-111111", url: "/pledges/p/spring-match-111111", address: POOL });
    expect(deployOk).toHaveBeenCalledOnce();
    expect(deployOk.mock.calls[0]![1]).toBe(DEMO_RECIPIENT);
    const rows = current!.tables[TABLE]!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows[0])).not.toContain("203.0.113.9");
  });

  it("says what is wrong without touching the chain", async () => {
    const r = await createPledge({ ...good, poolUsd: "900" }, "1.1.1.1", deployOk, NOW);
    expect(r.status).toBe(400);
    expect(deployOk).not.toHaveBeenCalled();
  });

  it("turns a visitor away after 3 in a day, counting only the last 24 hours", async () => {
    const first = await createPledge(good, "1.1.1.1", deployOk, NOW);
    const ipHash = (current!.tables[TABLE]![0]! as { ip_hash: string }).ip_hash;
    const recent = new Date(NOW - 3600_000).toISOString();
    const old = new Date(NOW - 25 * 3600_000).toISOString();
    expect(first.status).toBe(200);
    current!.tables[TABLE]![0]!.created_at = recent;
    current!.tables[TABLE]!.push({ slug: "b", ip_hash: ipHash, created_at: recent }, { slug: "c", ip_hash: ipHash, created_at: old });
    expect((await createPledge(good, "1.1.1.1", deployOk, NOW)).status).toBe(200);
    current!.tables[TABLE]!.at(-1)!.created_at = recent;
    const r = await createPledge(good, "1.1.1.1", deployOk, NOW);
    expect(r.status).toBe(429);
    expect((await createPledge(good, "2.2.2.2", deployOk, NOW)).status).toBe(200);
  });

  it("stops everyone at the global daily cap", async () => {
    const recent = new Date(NOW - 60_000).toISOString();
    current = fakeDb({ [TABLE]: Array.from({ length: 40 }, (_, i) => ({ slug: `s${i}`, ip_hash: `h${i}`, created_at: recent })) });
    const r = await createPledge(good, "9.9.9.9", deployOk, NOW);
    expect(r.status).toBe(429);
    expect(deployOk).not.toHaveBeenCalled();
  });

  it("before sql/008 runs, or with no database: a clear 503 and no deploy", async () => {
    current = fakeDb({}, {}, { missing: [TABLE] });
    const a = await createPledge(good, "1.1.1.1", deployOk, NOW);
    expect(a.status).toBe(503);
    expect(a.body.ok).toBe(false);
    current = null;
    expect((await createPledge(good, "1.1.1.1", deployOk, NOW)).status).toBe(503);
    expect(deployOk).not.toHaveBeenCalled();
  });

  it("reports a chain failure as 502 and stores nothing", async () => {
    const r = await createPledge(good, "1.1.1.1", async () => { throw new Error("The Tempo test faucet answered with status 413."); }, NOW);
    expect(r.status).toBe(502);
    expect((r.body as { error: string }).error).toContain("faucet");
    expect(current!.tables[TABLE] ?? []).toHaveLength(0);
  });

  it("finds a stored pledge by slug, and nothing for bad or unknown slugs", async () => {
    await createPledge(good, "1.1.1.1", deployOk, NOW);
    expect(await getSelfServe("spring-match-111111")).toMatchObject({ address: POOL, name: "Spring match" });
    expect(await getSelfServe("nope-000000")).toBeNull();
    expect(await getSelfServe("../etc")).toBeNull();
    current = fakeDb({}, {}, { missing: [TABLE] });
    expect(await getSelfServe("spring-match-111111")).toBeNull();
  });
});

describe("pool view", () => {
  const live: LiveNums = {
    poolUnits: "470000000",
    depositedUnits: "500000000",
    matchedUnits: "30000000",
    donatedUnits: "35000000",
    donationCount: 3,
    lockUntil: EXAMPLE_POOL.lockUntil,
    fetchedAt: 1,
    events: [
      { kind: "donated", tx: "0x3", time: 3, who: "0xabc0000000000000000000000000000000000001", amount: "$5", match: "$0", amountUnits: "5000000", matchUnits: "0" },
      { kind: "donated", tx: "0x2", time: 2, who: "0xabc0000000000000000000000000000000000001", amount: "$20", match: "$20", amountUnits: "20000000", matchUnits: "20000000" },
      { kind: "donated", tx: "0x1", time: 1, who: "0xdef0000000000000000000000000000000000002", amount: "$10", match: "$10", amountUnits: "10000000", matchUnits: "10000000" },
      { kind: "deposited", tx: "0x0", time: 0, who: EXAMPLE_POOL.sponsor, amount: "$500", amountUnits: "500000000" },
    ],
  };

  it("computes left, used share and distinct donors from live data", () => {
    const n = poolNumbers(EXAMPLE_POOL, live);
    expect(n).toMatchObject({ deposited: 500, left: 470, matched: 30, given: 35, gifts: 3, donors: 2 });
    expect(n.used).toBeCloseTo(0.06);
    expect(poolNumbers(EXAMPLE_POOL, null)).toMatchObject({ left: 500, used: 0, gifts: 0 });
  });

  it("writes steps from the pool's own rule", () => {
    const steps = howSteps({ ...EXAMPLE_POOL, matchBps: 20_000, capUsd: 25 }, poolNumbers(EXAMPLE_POOL, live));
    expect(steps.map((s) => s.title)).toEqual(["$500 set aside", "You give", "Matched 2:1", "Both arrive together"]);
    expect(steps[2]!.text).toContain("$25");
    expect(steps[3]!.text).toContain("Riverside Seed Library");
  });

  it("feeds activity with short addresses and a match chip only when matched", () => {
    const items = feed(live, EXAMPLE_POOL, "Riverside Neighbors Fund");
    expect(items[0]).toMatchObject({ who: "0xabc0…0001", match: undefined, title: expect.stringContaining("match already used") });
    expect(items[1]).toMatchObject({ match: "$20", href: expect.stringContaining("/tx/0x2") });
    expect(items[3]).toMatchObject({ kind: "deposited", title: "Riverside Neighbors Fund put $500 in the pool" });
  });
});
