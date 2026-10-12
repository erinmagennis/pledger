import { describe, expect, it } from "vitest";
import type { LineEntry, PaymentRecord } from "@/lib/claims";
import { avatarInitials, computeTotals, getPledge, lineStats, withLiveLine, type PoolTotals } from "@/lib/pledges";

const entry = (pid: string, label: string, feeCents: number, paidCents: number, firstAt: string): LineEntry => ({
  pid,
  place: 1,
  group: 2,
  label,
  projects: ["P"],
  feeCents,
  paidCents,
  status: "waiting",
  shortAddress: "0x…",
  firstAt,
});

describe("home tracker totals", () => {
  it("is all zeros and flat with no database and no pool", () => {
    const t = computeTotals(null, [], []);
    expect(t).toMatchObject({ paidCents: 0, testnetCents: 0, byKind: [], flat: true, people: [], peopleCount: 0 });
  });

  it("headline is mainnet payments only; testnet is separate", () => {
    const pays: PaymentRecord[] = [{ tx_hash: "0x1", to_address: "0xa", amount_units: "2500000", block_time: "2026-10-12T10:00:00Z" }];
    const pool: PoolTotals = {
      donatedUnits: "10000000",
      matchedUnits: "10000000",
      events: [
        { kind: "deposited", time: 1760000000, amountUnits: "500000000" },
        { kind: "donated", time: 1760140800, amountUnits: "10000000", matchUnits: "10000000" },
      ],
    };
    const t = computeTotals(pool, [], pays);
    expect(t.paidCents).toBe(250);
    expect(t.testnetCents).toBe(2000);
    expect(t.byKind.map((k) => k.kind)).toEqual(["matching", "give-back"]);
    // Two different days: a real curve, deposits excluded.
    expect(t.flat).toBe(false);
    expect(t.series).toEqual([2000, 2250]);
  });

  it("hides zero segments and stays flat with one day of data", () => {
    const pool: PoolTotals = { donatedUnits: "5000000", matchedUnits: "5000000", events: [{ kind: "donated", time: 1760140800, amountUnits: "5000000", matchUnits: "5000000" }] };
    const t = computeTotals(pool, [], []);
    expect(t.byKind).toEqual([{ kind: "matching", label: "Matching (testnet)", cents: 1000 }]);
    expect(t.flat).toBe(true);
  });

  it("feed shows the latest 3 events across testnet gifts and give-backs, newest first", () => {
    const pool: PoolTotals = {
      donatedUnits: "15000000",
      matchedUnits: "15000000",
      events: [
        { kind: "donated", time: 300, amountUnits: "5000000", matchUnits: "5000000", tx: "0xd3", who: "0xcb8bAAAA00000000000000000000000000008D7F", amount: "$5" },
        { kind: "donated", time: 100, amountUnits: "10000000", matchUnits: "10000000", tx: "0xd1", who: "0x1111000000000000000000000000000000002222", amount: "$10" },
        { kind: "deposited", time: 50, amountUnits: "500000000", tx: "0xdep", who: "0x5A76" },
      ],
    };
    const pays: PaymentRecord[] = [{ tx_hash: "0xp1", to_address: "0xabcdef0000000000000000000000000000001234", amount_units: "2500000", block_time: new Date(200_000).toISOString() }];
    const t = computeTotals(pool, [], pays);
    expect(t.feed.map((f) => f.text)).toEqual(["Visitor 0xcb8b…8D7F gave $5", "Give-back of $2.50 paid to 0xabcd…1234", "Visitor 0x1111…2222 gave $10"]);
    expect(t.feed[0]).toMatchObject({ av: "CB", testnet: true, href: "https://explore.testnet.tempo.xyz/tx/0xd3" });
    expect(t.feed[1]).toMatchObject({ av: null, testnet: false, href: "https://basescan.org/tx/0xp1" });
    expect(computeTotals(null, [], []).feed).toEqual([]);
  });

  it("avatars come from the most recent people in line, one per person", () => {
    const line = [entry("a", "A. O.", 100, 0, "2026-10-01"), entry("a", "A. O.", 50, 0, "2026-10-01"), entry("b", "Tide Pools", 70, 0, "2026-10-03")];
    const t = computeTotals(null, line, []);
    expect(t.people).toEqual(["TP", "AO"]);
    expect(t.peopleCount).toBe(2);
  });
});

describe("artizen line stats", () => {
  it("counts people, fees and paid", () => {
    const st = lineStats([entry("a", "x", 100, 40, "1"), entry("a", "x", 50, 0, "1"), entry("b", "y", 70, 70, "2")]);
    expect(st).toEqual({ people: 2, feesCents: 220, paidCents: 110 });
    const p = withLiveLine(getPledge("artizen-give-back")!, st);
    expect(p.stats.map((s) => s.value)).toEqual(["2", "$2.20", "$1.10"]);
    expect(p.cardStats!.map((s) => s.value)).toEqual(["2", "$2.20", "$1.10"]);
  });

  it("initials from names or projects", () => {
    expect(avatarInitials("Ana Ortiz")).toBe("AO");
    expect(avatarInitials("E. M.")).toBe("EM");
    expect(avatarInitials("")).toBe("?");
  });
});
