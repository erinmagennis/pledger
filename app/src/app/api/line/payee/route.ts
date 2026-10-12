import { NextResponse } from "next/server";
import { payoutAddressFor } from "@/lib/claims-server";
import { DB_MISSING, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Full payout address for one person in line, fetched only when someone presses Pay. */
export async function GET(req: Request) {
  const db = getSupabase();
  if (!db) return NextResponse.json(DB_MISSING, { status: 503 });
  const r = await payoutAddressFor(db, new URL(req.url).searchParams.get("pid") ?? "");
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ address: r.address });
}
