// POST /api/line/hold {pids, source}
// Hold people for 10 minutes while someone pays them, so "Help pay people back" skips them.
// source 'pledger': a Pledger preview or pay panel (refreshed when the payer signs).
// source 'outside': the payer pressed "I'm paying this outside Pledger".
// Holds are a courtesy: they never block recording a payment. Before sql/005 runs, nothing is held
// and the answer says held: false.
// In-memory limits per IP (src/lib/ratelimit.ts; reset on restart, per serverless instance): requests per
// window, and at most PER_IP_HELD people held at once. Holding more ends that IP's oldest holds.
// Cooldown (claims-server holdCooldowns): a person whose hold ran out in the last 20 minutes with no payment
// recorded since is not held again; their pid comes back in `skipped`.
import { NextResponse } from "next/server";
import { isHoldSource } from "@/lib/claims";
import { createHolds, endHolds, payoutAddressesFor } from "@/lib/claims-server";
import { ipOf, limit } from "@/lib/ratelimit";
import { DB_MISSING, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PIDS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const PER_IP = 60;
const PER_IP_HELD = 10;
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

export async function POST(req: Request) {
  const db = getSupabase();
  if (!db) return NextResponse.json(DB_MISSING, { status: 503 });
  let body: { pids?: unknown; source?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("Send pids and source");
  }
  if (!body || typeof body !== "object") return bad("Send a JSON object");
  if (!isHoldSource(body.source)) return bad("Send pids and source");
  if (!Array.isArray(body.pids) || !body.pids.length || !body.pids.every((p) => typeof p === "string")) return bad("Send pids and source");
  const pids = [...new Set(body.pids as string[])];
  if (pids.length > MAX_PIDS) return bad(`Up to ${MAX_PIDS} people at a time`);

  const ip = ipOf(req);
  const now = Date.now();
  if (!limit("line-hold", ip, PER_IP, WINDOW_MS, now)) return bad("Too many holds from here. Try again in a few minutes.", 429);

  try {
    const addresses = await payoutAddressesFor(db, pids);
    if (!addresses.size) return bad("Unknown person", 404);
    const r = await createHolds(db, [...addresses.values()], body.source, now);
    if (r.ok) {
      const held = [...addresses].flatMap(([pid, a]): [string, string][] => (r.ids.has(a) ? [[pid, r.ids.get(a)!]] : []));
      const skipped = [...addresses].filter(([, a]) => r.skipped.includes(a)).map(([pid]) => pid);
      if (held.length) await endHolds(db, trackHolds(ip, held, Date.parse(r.until), now), now);
      // `skipped`: a hold on them just ran out with no payment, so they stay open to everyone for a while.
      return NextResponse.json({ held: held.length > 0, until: r.until, pids: held.map(([pid]) => pid), skipped });
    }
    if (r.missing) return NextResponse.json({ held: false, pids: [...addresses.keys()] });
    return bad(r.error, 500);
  } catch {
    return bad("Could not hold", 500);
  }
}
