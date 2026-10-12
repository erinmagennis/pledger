import { describe, expect, it } from "vitest";
import { buildLine, statusText, type ClaimRecord, type PaymentRecord } from "@/lib/claims";

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
});
