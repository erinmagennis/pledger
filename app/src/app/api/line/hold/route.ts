// POST /api/line/hold {pids, source}
// Hold people for 10 minutes while someone pays them, so "Help pay people back" skips them.
// source 'pledger': a Pledger preview or pay panel (refreshed when the payer signs).
// source 'outside': the payer pressed "I'm paying this outside Pledger".
// Holds are a courtesy: they never block recording a payment. Before sql/005 runs, nothing is held
// and the answer says held: false.
// In-memory limits per IP, like /api/demo/fund (reset on restart, per serverless instance): requests per
// window, and at most PER_IP_HELD people held at once. Holding more ends that IP's oldest holds.
import { NextResponse } from "next/server";
import { isHoldSource } from "@/lib/claims";
import { createHolds, endHolds, payoutAddressesFor } from "@/lib/claims-server";
import { DB_MISSING, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PIDS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const PER_IP = 60;
const PER_IP_HELD = 10;
const ipHits = new Map<string, number[]>();
/** Per IP: pid -> its hold row id and expiry, oldest first (Map keeps insertion order). */
const ipHeld = new Map<string, Map<string, { id: string; until: number }>>();

/** Record this IP's new holds, drop expired ones, and return the row ids of the oldest past the cap. */
function trackHolds(ip: string, held: [pid: string, id: string][], until: number, now: number): string[] {
  const mine = ipHeld.get(ip) ?? new Map<string, { id: string; until: number }>();
  for (const [pid, h] of mine) if (h.until <= now) mine.delete(pid);
  for (const [pid, id] of held) {
    mine.delete(pid); // re-insert so a refreshed hold counts as newest
    mine.set(pid, { id, until });
  }
  const dropped: string[] = [];
  for (const [pid, h] of mine) {
    if (mine.size <= PER_IP_HELD) break;
    mine.delete(pid);
    dropped.push(h.id);
  }
  if (mine.size) ipHeld.set(ip, mine);
  else ipHeld.delete(ip);
  return dropped;
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

export async function POST(req: Request) {
  const db = getSupabase();
  if (!db) return NextResponse.json(DB_MISSING, { status: 503 });
  let body: { pids?: unknown; source?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("Send pids and source");
  }
  if (!isHoldSource(body.source)) return bad("Send pids and source");
  if (!Array.isArray(body.pids) || !body.pids.length || !body.pids.every((p) => typeof p === "string")) return bad("Send pids and source");
  const pids = [...new Set(body.pids as string[])];
  if (pids.length > MAX_PIDS) return bad(`Up to ${MAX_PIDS} people at a time`);

  const ip = clientIp(req);
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= PER_IP) return bad("Too many holds from here. Try again in a few minutes.", 429);
  hits.push(now);
  ipHits.set(ip, hits);

  try {
    const addresses = await payoutAddressesFor(db, pids);
    if (!addresses.size) return bad("Unknown person", 404);
    const r = await createHolds(db, [...addresses.values()], body.source, now);
    if (r.ok) {
      const held = [...addresses].flatMap(([pid, a]): [string, string][] => (r.ids.has(a) ? [[pid, r.ids.get(a)!]] : []));
      await endHolds(db, trackHolds(ip, held, Date.parse(r.until), now), now);
      return NextResponse.json({ held: true, until: r.until, pids: [...addresses.keys()] });
    }
    if (r.missing) return NextResponse.json({ held: false, pids: [...addresses.keys()] });
    return bad(r.error, 500);
  } catch {
    return bad("Could not hold", 500);
  }
}
