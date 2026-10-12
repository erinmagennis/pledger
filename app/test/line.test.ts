import { describe, expect, it } from "vitest";
import { buildLine, statusText, type ClaimRecord, type PaymentRecord } from "@/lib/claims";
import { owedUnits } from "@/lib/payments-server";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";

let n = 0;
function claim(addr: string, feeCents: number, selfBacked: boolean, created: string, label = "X. Y."): ClaimRecord {
  n++;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
    fingerprint: n.toString(16).padStart(64, "0"),
    project: `P${n}`,
    purchased_at: "2026-08-01T00:00:00.000Z",
    fee_cents: feeCents,
    self_backed: selfBacked,
    payout_address: addr,
    display_mode: "initials",
    display_name: label,
    created_at: created,
  };
}

describe("buildLine ordering", () => {
  it("puts self-backed first, each group ascending, ties to the earlier claim", () => {
    const claims = [
      claim(A, 5000, false, "2026-10-01T00:00:00Z", "A."),
      claim(B, 2000, false, "2026-10-02T00:00:00Z", "B."),
      claim(C, 9000, true, "2026-10-03T00:00:00Z", "C."),
      claim(A, 1000, true, "2026-10-04T00:00:00Z", "A."),
      claim(B, 1000, true, "2026-10-01T00:00:00Z", "B."),
    ];
    const line = buildLine(claims, []);
    expect(line.map((e) => [e.place, e.label, e.group, e.feeCents])).toEqual([
      [1, "B.", 1, 1000], // tie with A at 1000; B claimed earlier
      [2, "A.", 1, 1000],
      [3, "C.", 1, 9000],
      [4, "B.", 2, 2000],
      [5, "A.", 2, 5000],
    ]);
  });

  it("sums fees per person per group and lists projects", () => {
    const line = buildLine([claim(A, 300, false, "2026-10-01T00:00:00Z"), claim(A, 700, false, "2026-10-02T00:00:00Z")], []);
    expect(line).toHaveLength(1);
    expect(line[0]!.feeCents).toBe(1000);
    expect(line[0]!.projects).toHaveLength(2);
    expect(line[0]!.shortAddress).toBe("0xaaaa…aaaa");
    expect(JSON.stringify(line)).not.toContain(A); // no full address in the public line
  });

  it("uses project names for project-only display", () => {
    const c = { ...claim(A, 100, false, "2026-10-01T00:00:00Z"), display_mode: "project" as const, display_name: null, project: "Purses" };
    expect(buildLine([c], [])[0]!.label).toBe("Purses");
  });

  it("fills a person's entries in line order with payments", () => {
    const claims = [claim(A, 1000, true, "2026-10-01T00:00:00Z"), claim(A, 4000, false, "2026-10-01T00:00:00Z"), claim(B, 500, false, "2026-10-01T00:00:00Z")];
    const payments: PaymentRecord[] = [
      { tx_hash: "0x1", to_address: A.toUpperCase().replace("0X", "0x"), amount_units: "15000000", block_time: "2026-10-05T00:00:00Z" }, // $15
    ];
    const line = buildLine(claims, payments);
    const a1 = line.find((e) => e.group === 1)!;
    const a2 = line.find((e) => e.group === 2 && e.feeCents === 4000)!;
    const b = line.find((e) => e.feeCents === 500)!;
    expect([a1.status, a1.paidCents]).toEqual(["paid", 1000]);
    expect([a2.status, a2.paidCents]).toEqual(["partial", 500]);
    expect(statusText(a2)).toBe("Paid $5 of $40");
    expect(b.status).toBe("waiting");
  });

  describe("forgiveness band: 99.5% of a fee is paid in full", () => {
    const pay = (to: string, units: string, tx = "0x1"): PaymentRecord => ({ tx_hash: tx, to_address: to, amount_units: units, block_time: "2026-10-05T00:00:00Z" });

    it("$10 paid with 9,950,000 units is paid and owes nothing", () => {
      const [e] = buildLine([claim(C, 1000, false, "2026-10-01T00:00:00Z")], [pay(C, "9950000")]);
      expect([e!.status, e!.paidCents]).toEqual(["paid", 1000]);
      expect(owedUnits([e!])).toBe(0n);
    });

    it("$0.75 paid with 746,250 units is paid", () => {
      const [e] = buildLine([claim(C, 75, false, "2026-10-01T00:00:00Z")], [pay(C, "746250")]);
      expect([e!.status, e!.paidCents]).toEqual(["paid", 75]);
      expect(owedUnits([e!])).toBe(0n);
    });

    it("two payments are summed in units: 4,999,999 + 5,000,001 is exactly $10", () => {
      const [e] = buildLine([claim(C, 1000, false, "2026-10-01T00:00:00Z")], [pay(C, "4999999"), pay(C, "5000001", "0x2")]);
      expect([e!.status, e!.paidCents]).toEqual(["paid", 1000]);
    });

    it("below 99.5% stays partial, and a forgiven shortfall is not carried to the next entry", () => {
      const [p] = buildLine([claim(C, 1000, false, "2026-10-01T00:00:00Z")], [pay(C, "9949999")]);
      expect([p!.status, p!.paidCents]).toEqual(["partial", 994]);
      const line = buildLine([claim(C, 1000, true, "2026-10-01T00:00:00Z"), claim(C, 500, false, "2026-10-01T00:00:00Z")], [pay(C, "9950000")]);
      expect(line.map((e) => [e.status, e.paidCents])).toEqual([["paid", 1000], ["waiting", 0]]);
    });

    it("forgives against the person's total: $10 + $5 paid with 14,925,000 units is all paid", () => {
      const line = buildLine([claim(C, 1000, true, "2026-10-01T00:00:00Z"), claim(C, 500, false, "2026-10-01T00:00:00Z")], [pay(C, "14925000")]);
      expect(line.map((e) => [e.status, e.paidCents])).toEqual([["paid", 1000], ["paid", 500]]);
      expect(owedUnits(line)).toBe(0n);
    });
  });
});
