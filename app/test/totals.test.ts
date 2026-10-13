import { describe, expect, it } from "vitest";
import { paidFromLine, shortAddress, type LineEntry, type PaymentRecord } from "@/lib/claims";
import { avatarInitials, computeTotals, getPledge, lineStats, withLiveLine, type PoolTotals } from "@/lib/pledges";

const entry = (pid: string, label: string, feeCents: number, paidCents: number, firstAt: string, shortAddress = "0x…"): LineEntry => ({
  pid,
  place: 1,
  group: 2,
  label,
  projects: ["P"],
  feeCents,
  paidCents,
  status: "waiting",
  shortAddress,
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
    // The headline comes from the line (capped at each fee), so the line carries the paid $2.50.
    const t = computeTotals(pool, [entry("a", "x", 250, 250, "1", "0xa")], pays);
    expect(t.paidCents).toBe(250);
    expect(t.testnetCents).toBe(2000);
    expect(t.byKind.map((k) => k.kind)).toEqual(["matching", "give-back"]);
    // The chart follows the headline: test money leads, so only testnet gifts are on it (deposits and real payments excluded).
    expect(t.flat).toBe(false);
    expect(t.seriesDemo).toBe(true);
    expect(t.series).toEqual([0, 2000]);
  });

  it("hides zero segments; one gift still draws a climb from zero", () => {
    const pool: PoolTotals = { donatedUnits: "5000000", matchedUnits: "5000000", events: [{ kind: "donated", time: 1760140800, amountUnits: "5000000", matchUnits: "5000000" }] };
    const t = computeTotals(pool, [], []);
    expect(t.byKind).toEqual([{ kind: "matching", label: "Demo match pool (test money)", cents: 1000 }]);
    expect(t.flat).toBe(false);
    expect(t.series).toEqual([0, 1000]);
  });

  it("several same-day gifts give one point each, oldest first, ending at the headline", () => {
    const g = (time: number, units: string) => ({ kind: "donated" as const, time, amountUnits: units, matchUnits: units });
    const pool: PoolTotals = {
      donatedUnits: "42500000",
      matchedUnits: "42500000",
      events: [g(1760140900, "25000000"), { kind: "deposited", time: 1760140000, amountUnits: "500000000" }, g(1760140800, "10000000"), g(1760141000, "7500000")],
    };
    const t = computeTotals(pool, [], []);
    expect(t.seriesDemo).toBe(true);
    expect(t.series).toEqual([0, 2000, 7000, 8500]);
    expect(t.series.at(-1)).toBe(t.testnetCents);
  });

  it("real give-backs drive the chart when there is no test money", () => {
    const pays: PaymentRecord[] = [{ tx_hash: "0x1", to_address: "0xa", amount_units: "2500000", block_time: "2026-10-12T10:00:00Z" }];
    const t = computeTotals(null, [entry("a", "x", 250, 250, "1", "0xa")], pays);
    expect(t).toMatchObject({ seriesDemo: false, flat: false, series: [0, 250] });
    expect(computeTotals(null, [], [])).toMatchObject({ seriesDemo: false, flat: true });
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
    expect(t.feed.map((f) => f.text)).toEqual(["0xcb8b…8D7F gave $5", "Give-back of $2.50 paid", "0x1111…2222 gave $10"]);
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

describe("paid totals, one capped number", () => {
  it("home and pledge page agree, each entry capped at its fee", () => {
    // An old overpay: $50 paid on a $10 fee counts as $10 on both pages.
    const line = [entry("a", "x", 1000, 5000, "1"), entry("b", "y", 700, 300, "2")];
    expect(paidFromLine(line)).toBe(1300);
    expect(lineStats(line).paidCents).toBe(1300);
    const pays: PaymentRecord[] = [{ tx_hash: "0x1", to_address: "0xa", amount_units: "50000000", block_time: "2026-10-12T10:00:00Z" }];
    expect(computeTotals(null, line, pays).paidCents).toBe(1300);
  });
});

describe("chart is capped like the headline", () => {
  it("never ends above the headline: overpay capped at the fee, 99.5% counted as the full fee", () => {
    const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const line = [
      { ...entry("a", "x", 1000, 1000, "1", shortAddress(A)), status: "paid" as const },
      { ...entry("b", "y", 1000, 1000, "2", shortAddress(B)), status: "paid" as const },
    ];
    const pays: PaymentRecord[] = [
      { tx_hash: "0x1", to_address: A, amount_units: "30000000", block_time: "2026-10-10T10:00:00Z" }, // $30 on a $10 fee
      { tx_hash: "0x2", to_address: B, amount_units: "9950000", block_time: "2026-10-11T10:00:00Z" }, // $9.95 forgiven to $10
      { tx_hash: "0x3", to_address: "0xcccccccccccccccccccccccccccccccccccccccc", amount_units: "5000000", block_time: "2026-10-12T10:00:00Z" }, // not in line
    ];
    const t = computeTotals(null, line, pays);
    expect(t.paidCents).toBe(2000);
    expect(t.series).toEqual([0, 1000, 2000, 2000]);
  });
});

describe("artizen line stats", () => {
  it("counts people, fees and paid", () => {
    const st = lineStats([entry("a", "x", 100, 40, "1"), entry("a", "x", 50, 0, "1"), entry("b", "y", 70, 70, "2")]);
    expect(st).toEqual({ people: 2, feesCents: 220, paidCents: 110 });
    const p = withLiveLine(getPledge("artizen")!, st);
    expect(p.stats.map((s) => s.value)).toEqual(["2", "$2.20", "$1.10"]);
    expect(p.cardStats!.map((s) => s.value)).toEqual(["2", "$2.20", "$1.10"]);
  });

  it("initials from names or projects", () => {
    expect(avatarInitials("Ana Ortiz")).toBe("AO");
    expect(avatarInitials("E. M.")).toBe("EM");
    expect(avatarInitials("")).toBe("?");
  });
});
