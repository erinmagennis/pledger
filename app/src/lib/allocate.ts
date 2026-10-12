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
  /** Someone else is paying this person right now (a hold): skipped, never split to. */
  held?: boolean;
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
  /** Amount mode only: what was asked for but not sent (too little for the next person, or no one left). */
  leftoverUnits: bigint;
  /** Amount mode only: what the next person who did not fit is owed, or 0n when no one is left. */
  nextUnits: bigint;
};

const EMPTY: Allocation = { transfers: [], totalUnits: 0n, leftoverUnits: 0n, nextUnits: 0n };

/** Open entries grouped by person (payout address), in order of each person's first place. */
function byPerson(open: AllocEntry[]): { entries: AllocEntry[]; owed: bigint }[] {
  const people = new Map<string, { entries: AllocEntry[]; owed: bigint }>();
  for (const e of open) {
    const a = e.address.toLowerCase();
    let p = people.get(a);
    if (!p) {
      p = { entries: [], owed: 0n };
      people.set(a, p);
    }
    p.entries.push(e);
    p.owed += e.remainingUnits;
  }
  return [...people.values()];
}

/**
 * Fill the line in order, skipping anyone already paid or held by another helper. A payment only counts when it is a person's
 * full remaining amount, so both modes pay whole people: every open entry of each person picked.
 * amount: whole people in line order until the next one does not fit; the rest comes back as leftoverUnits.
 * nextN: the next N people (distinct payout addresses), each for their full remaining amount.
 * Entries for the same payout address are merged into one transfer.
 */
export function allocate(entries: AllocEntry[], mode: AllocMode): Allocation {
  const open = entries.filter((e) => e.remainingUnits > 0n && !e.held);
  const picks: { e: AllocEntry; units: bigint }[] = [];

  if (mode.kind === "amount") {
    if (mode.amountUnits <= 0n) return EMPTY;
    let left = mode.amountUnits;
    let nextUnits = 0n;
    for (const p of byPerson(open)) {
      if (p.owed > left) {
        nextUnits = p.owed;
        break;
      }
      for (const e of p.entries) picks.push({ e, units: e.remainingUnits });
      left -= p.owed;
    }
    return { ...merge(picks, left), nextUnits };
  }

  const n = Math.floor(mode.n);
  if (!Number.isFinite(n) || n <= 0) return EMPTY;
  const people = new Set<string>();
  for (const e of open) {
    const a = e.address.toLowerCase();
    if (!people.has(a)) {
      // Keep going: a person already picked can have a later entry further down.
      if (people.size === n) continue;
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
  return { transfers: [...byAddr.values()], totalUnits, leftoverUnits, nextUnits: 0n };
}
