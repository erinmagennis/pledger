import { after, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLineWithHolds } from "@/lib/claims-server";
import type { LineEntry } from "@/lib/claims";
import { retryStuckRecords } from "@/lib/records-retry";
import { DB_MISSING, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The records sweep runs after the answer and may wait for Base txs.
export const maxDuration = 60;

/** How long one read of the line is reused, per server instance. Kept with the client it came from. */
const LINE_CACHE_MS = 5_000;
let cache: { db: object; at: number; line: LineEntry[]; updatedAt: string } | null = null;

/** Start the records sweep after the answer. Outside a request (tests, scripts) there is no after(): skip it. */
function sweepLater(db: SupabaseClient) {
  try {
    after(() => retryStuckRecords(db).then(() => undefined));
  } catch {
    // no request scope
  }
}

/** Public line. Short addresses only; the full address is fetched per person from /api/line/payee.
 * People someone is paying right now carry `held` and `heldUntil` (sql/005; nobody is held before it runs).
 * Reads are reused for 5 seconds per instance. Each call may also start the records sweep (records-retry.ts),
 * which runs at most once every 5 minutes per instance. */
export async function GET() {
  const db = getSupabase();
  if (!db) return NextResponse.json({ ...DB_MISSING, line: [] }, { status: 503 });
  sweepLater(db);
  const now = Date.now();
  if (cache && cache.db === db && now - cache.at < LINE_CACHE_MS) return NextResponse.json({ line: cache.line, updatedAt: cache.updatedAt });
  try {
    const line = await loadLineWithHolds(db);
    cache = { db, at: now, line, updatedAt: new Date(now).toISOString() };
    return NextResponse.json({ line, updatedAt: cache.updatedAt });
  } catch {
    return NextResponse.json({ error: "Could not load the line", line: [] }, { status: 500 });
  }
}
