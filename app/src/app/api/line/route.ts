import { NextResponse } from "next/server";
import { loadLineWithHolds } from "@/lib/claims-server";
import { DB_MISSING, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public line. Short addresses only; the full address is fetched per person from /api/line/payee.
 * People someone is paying right now carry `held` and `heldUntil` (sql/005; nobody is held before it runs). */
export async function GET() {
  const db = getSupabase();
  if (!db) return NextResponse.json({ ...DB_MISSING, line: [] }, { status: 503 });
  try {
    const line = await loadLineWithHolds(db);
    return NextResponse.json({ line, updatedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: "Could not load the line", line: [] }, { status: 500 });
  }
}
