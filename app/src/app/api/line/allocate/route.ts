import { NextResponse } from "next/server";
import { allocate, type AllocEntry, type AllocMode } from "@/lib/allocate";
import { centsToUnits, shortAddress, toCents, unitsToCents } from "@/lib/claims";
import { loadLineWithHolds, payoutAddressesFor } from "@/lib/claims-server";
import { DB_MISSING, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_USD = 100_000;
const MAX_N = 50;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * Split a helper's payment across the line: an amount in USD, or the next N people.
 * Returns full payout addresses (looked up here, never stored in the public line).
 * People held by another helper are skipped. `mine` lists the pids this helper holds, so their own
 * hold (made by the preview) does not hide those people from them.
 */
export async function POST(req: Request) {
  const db = getSupabase();
  if (!db) return NextResponse.json(DB_MISSING, { status: 503 });
  let body: { amountUsd?: unknown; nextN?: unknown; mine?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("Send an amount or a number of people");
  }

  let mode: AllocMode;
  let requestedCents: number | null = null;
  if (body.amountUsd !== undefined && body.amountUsd !== null) {
    const usd = Number(body.amountUsd);
    if (!Number.isFinite(usd) || usd <= 0) return bad("Enter an amount above $0");
    if (usd > MAX_USD) return bad(`Up to $${MAX_USD.toLocaleString("en-US")} at a time`);
    requestedCents = toCents(usd);
    if (requestedCents <= 0) return bad("Enter an amount above $0");
    mode = { kind: "amount", amountUnits: centsToUnits(requestedCents) };
  } else if (body.nextN !== undefined && body.nextN !== null) {
    const n = Number(body.nextN);
    if (!Number.isInteger(n) || n < 1 || n > MAX_N) return bad(`Pick 1 to ${MAX_N} people`);
    mode = { kind: "nextN", n };
  } else {
    return bad("Send an amount or a number of people");
  }

  const mine = new Set(Array.isArray(body.mine) ? body.mine.filter((p): p is string => typeof p === "string").slice(0, MAX_N) : []);

  try {
    const line = await loadLineWithHolds(db);
    // Same test as owedUnits: a paid entry (including a forgiven one) owes nothing.
    const open = line.filter((e) => e.status !== "paid" && e.feeCents > e.paidCents);
    const addresses = await payoutAddressesFor(db, open.map((e) => e.pid));
    const entries: AllocEntry[] = open.flatMap((e) => {
      const address = addresses.get(e.pid);
      if (!address) return [];
      const held = !!e.held && !mine.has(e.pid);
      return [{ entryId: `${e.pid}-${e.group}`, pid: e.pid, address, label: e.label, place: e.place, remainingUnits: centsToUnits(e.feeCents - e.paidCents), held }];
    });
    const r = allocate(entries, mode);
    return NextResponse.json({
      transfers: r.transfers.map((t) => ({
        pid: t.pid,
        address: t.address,
        shortAddress: shortAddress(t.address),
        label: t.label,
        places: t.places,
        amountUnits: t.amountUnits.toString(),
        amountCents: unitsToCents(t.amountUnits),
      })),
      totalUnits: r.totalUnits.toString(),
      totalCents: unitsToCents(r.totalUnits),
      leftoverCents: unitsToCents(r.leftoverUnits),
      nextCents: unitsToCents(r.nextUnits),
      requestedCents,
      /** People skipped because someone else is paying them right now. */
      heldCount: new Set(entries.filter((e) => e.held).map((e) => e.pid)).size,
    });
  } catch {
    return bad("Could not load the line", 500);
  }
}
