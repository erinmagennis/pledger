// Split a helper's payment across the line. Pure: safe for client, server and tests.
// All amounts are USDC base units (6 decimals) as bigint.

export type AllocEntry = {
  /** Unique per line entry (a person can hold two entries: self-backed and backed others). */
  entryId: string;
  pid: string;
  address: string;
  label: string;
  place: number;
  remainingUnits: bigint;
};

export type AllocMode = { kind: "amount"; amountUnits: bigint } | { kind: "nextN"; n: number };

export type Transfer = {
  address: string;
  pid: string;
  label: string;
  /** Line places covered by this transfer, in line order. */
  places: number[];
  entryIds: string[];
  amountUnits: bigint;
};

export type Allocation = {
  transfers: Transfer[];
  totalUnits: bigint;
  /** Amount mode only: what was asked for but is not owed to anyone. */
  leftoverUnits: bigint;
};

const EMPTY: Allocation = { transfers: [], totalUnits: 0n, leftoverUnits: 0n };

/**
 * Fill the line in order, skipping anyone already paid.
 * amount: the last entry may be partial; anything above the total owed comes back as leftoverUnits.
 * nextN: the next N people (distinct payout addresses), each for their full remaining amount.
 * Entries for the same payout address are merged into one transfer.
 */
export function allocate(entries: AllocEntry[], mode: AllocMode): Allocation {
  const open = entries.filter((e) => e.remainingUnits > 0n);
  const picks: { e: AllocEntry; units: bigint }[] = [];

  if (mode.kind === "amount") {
    if (mode.amountUnits <= 0n) return EMPTY;
    let left = mode.amountUnits;
    for (const e of open) {
      if (left === 0n) break;
      const units = e.remainingUnits < left ? e.remainingUnits : left;
      picks.push({ e, units });
      left -= units;
    }
    return merge(picks, left);
  }

  const n = Math.floor(mode.n);
  if (!Number.isFinite(n) || n <= 0) return EMPTY;
  const people = new Set<string>();
  for (const e of open) {
    const a = e.address.toLowerCase();
    if (!people.has(a)) {
      if (people.size === n) break;
      people.add(a);
    }
    picks.push({ e, units: e.remainingUnits });
  }
  return merge(picks, 0n);
}

function merge(picks: { e: AllocEntry; units: bigint }[], leftoverUnits: bigint): Allocation {
  const byAddr = new Map<string, Transfer>();
  let totalUnits = 0n;
  for (const { e, units } of picks) {
    const a = e.address.toLowerCase();
    let t = byAddr.get(a);
    if (!t) {
      t = { address: a, pid: e.pid, label: e.label, places: [], entryIds: [], amountUnits: 0n };
      byAddr.set(a, t);
    }
    t.places.push(e.place);
    t.entryIds.push(e.entryId);
    t.amountUnits += units;
    totalUnits += units;
  }
  return { transfers: [...byAddr.values()], totalUnits, leftoverUnits };
}
