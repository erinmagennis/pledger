import { describe, expect, it } from "vitest";
import { allocate, type AllocEntry } from "@/lib/allocate";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";
const D = "0xdddddddddddddddddddddddddddddddddddddddd";
const usd = (n: number) => BigInt(Math.round(n * 100)) * 10_000n;

function entry(place: number, address: string, owedUsd: number): AllocEntry {
  return { entryId: `e${place}`, pid: `p-${address.slice(2, 4)}`, address, label: `L${place}`, place, remainingUnits: usd(owedUsd) };
}

const line = [entry(1, A, 10), entry(2, B, 20), entry(3, C, 30)];
const sent = (r: ReturnType<typeof allocate>) => r.transfers.map((t) => [t.address, t.amountUnits]);

describe("allocate by amount", () => {
  it("fills the line exactly", () => {
    const r = allocate(line, { kind: "amount", amountUnits: usd(30) });
    expect(sent(r)).toEqual([[A, usd(10)], [B, usd(20)]]);
    expect(r.totalUnits).toBe(usd(30));
    expect(r.leftoverUnits).toBe(0n);
  });

  it("pays whole people only: the last person is dropped and the leftover reported", () => {
    // $25 covers A ($10) but not B ($20): $15 left over, next person owed $20.
    const r = allocate(line, { kind: "amount", amountUnits: usd(25) });
    expect(sent(r)).toEqual([[A, usd(10)]]);
    expect(r.totalUnits).toBe(usd(10));
    expect(r.leftoverUnits).toBe(usd(15));
    expect(r.nextUnits).toBe(usd(20));
  });

  it("sends nothing when the amount is less than the next person is owed", () => {
    const r = allocate(line, { kind: "amount", amountUnits: usd(5) });
    expect(r.transfers).toEqual([]);
    expect(r.leftoverUnits).toBe(usd(5));
    expect(r.nextUnits).toBe(usd(10));
  });

  it("stops at the first person who does not fit, even if someone later would", () => {
    const r = allocate([entry(1, A, 10), entry(2, B, 50), entry(3, C, 5)], { kind: "amount", amountUnits: usd(20) });
    expect(sent(r)).toEqual([[A, usd(10)]]);
    expect(r.nextUnits).toBe(usd(50));
  });

  it("caps at the total owed and reports the leftover", () => {
    const r = allocate(line, { kind: "amount", amountUnits: usd(100) });
    expect(r.totalUnits).toBe(usd(60));
    expect(r.leftoverUnits).toBe(usd(40));
    expect(r.nextUnits).toBe(0n);
    expect(r.transfers).toHaveLength(3);
  });

  it("skips people already paid", () => {
    const r = allocate([{ ...line[0]!, remainingUnits: 0n }, ...line.slice(1)], { kind: "amount", amountUnits: usd(50) });
    expect(sent(r)).toEqual([[B, usd(20)], [C, usd(30)]]);
  });

  it("a person counts as a whole: all their places, merged into one transfer", () => {
    const withRepeat = [entry(1, A, 10), entry(2, B, 20), entry(3, A, 5), entry(4, C, 30)];
    // A owes $15 in total (places 1 and 3), then B $20. $40 covers both, not C.
    const r = allocate(withRepeat, { kind: "amount", amountUnits: usd(40) });
    expect(sent(r)).toEqual([[A, usd(15)], [B, usd(20)]]);
    expect(r.transfers[0]!.places).toEqual([1, 3]);
    expect(r.transfers[0]!.entryIds).toEqual(["e1", "e3"]);
    expect(r.totalUnits).toBe(usd(35));
    expect(r.leftoverUnits).toBe(usd(5));
  });

  it("returns nothing for zero or negative amounts", () => {
    for (const amountUnits of [0n, -usd(5)]) {
      const r = allocate(line, { kind: "amount", amountUnits });
      expect(r.transfers).toEqual([]);
      expect(r.totalUnits).toBe(0n);
      expect(r.leftoverUnits).toBe(0n);
    }
  });
});

describe("allocate next N people", () => {
  it("pays the next N in full, skipping the paid", () => {
    const r = allocate([{ ...line[0]!, remainingUnits: 0n }, ...line.slice(1), entry(4, D, 40)], { kind: "nextN", n: 2 });
    expect(sent(r)).toEqual([[B, usd(20)], [C, usd(30)]]);
    expect(r.totalUnits).toBe(usd(50));
  });

  it("counts people, not entries, and merges a repeat address", () => {
    const withRepeat = [entry(1, A, 10), entry(2, A, 5), entry(3, B, 20), entry(4, C, 30)];
    const r = allocate(withRepeat, { kind: "nextN", n: 2 });
    expect(sent(r)).toEqual([[A, usd(15)], [B, usd(20)]]);
  });

  it("includes a picked person's later place after the Nth person", () => {
    // A(10), B(10), C(10), A(10) with n=2 pays A $20 and B $10, not C.
    const r = allocate([entry(1, A, 10), entry(2, B, 10), entry(3, C, 10), entry(4, A, 10)], { kind: "nextN", n: 2 });
    expect(sent(r)).toEqual([[A, usd(20)], [B, usd(10)]]);
    expect(r.transfers[0]!.places).toEqual([1, 4]);
  });

  it("takes everyone when N is larger than the line", () => {
    expect(allocate(line, { kind: "nextN", n: 5 }).totalUnits).toBe(usd(60));
  });

  it("returns nothing for zero or negative N", () => {
    expect(allocate(line, { kind: "nextN", n: 0 }).transfers).toEqual([]);
    expect(allocate(line, { kind: "nextN", n: -2 }).transfers).toEqual([]);
  });
});
