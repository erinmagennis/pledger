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

  it("pays the last person partly", () => {
    const r = allocate(line, { kind: "amount", amountUnits: usd(25) });
    expect(sent(r)).toEqual([[A, usd(10)], [B, usd(15)]]);
    expect(r.totalUnits).toBe(usd(25));
  });

  it("caps at the total owed and reports the leftover", () => {
    const r = allocate(line, { kind: "amount", amountUnits: usd(100) });
    expect(r.totalUnits).toBe(usd(60));
    expect(r.leftoverUnits).toBe(usd(40));
    expect(r.transfers).toHaveLength(3);
  });

  it("skips people already paid", () => {
    const r = allocate([{ ...line[0]!, remainingUnits: 0n }, ...line.slice(1)], { kind: "amount", amountUnits: usd(25) });
    expect(sent(r)).toEqual([[B, usd(20)], [C, usd(5)]]);
  });

  it("merges entries for the same address into one transfer", () => {
    const withRepeat = [entry(1, A, 10), entry(2, B, 20), entry(3, A, 5), entry(4, C, 30)];
    const r = allocate(withRepeat, { kind: "amount", amountUnits: usd(40) });
    expect(sent(r)).toEqual([[A, usd(15)], [B, usd(20)], [C, usd(5)]]);
    expect(r.transfers[0]!.places).toEqual([1, 3]);
    expect(r.transfers[0]!.entryIds).toEqual(["e1", "e3"]);
    expect(r.totalUnits).toBe(usd(40));
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

  it("takes everyone when N is larger than the line", () => {
    expect(allocate(line, { kind: "nextN", n: 5 }).totalUnits).toBe(usd(60));
  });

  it("returns nothing for zero or negative N", () => {
    expect(allocate(line, { kind: "nextN", n: 0 }).transfers).toEqual([]);
    expect(allocate(line, { kind: "nextN", n: -2 }).transfers).toEqual([]);
  });
});
