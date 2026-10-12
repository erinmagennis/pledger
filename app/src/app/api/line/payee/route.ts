import { NextResponse } from "next/server";
import { DB_MISSING, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Full payout address for one person in line, fetched only when someone presses Pay. */
export async function GET(req: Request) {
  const db = getSupabase();
  if (!db) return NextResponse.json(DB_MISSING, { status: 503 });
  const pid = new URL(req.url).searchParams.get("pid") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(pid)) return NextResponse.json({ error: "Unknown person" }, { status: 400 });
  const { data, error } = await db.from("pledger_claims").select("payout_address").eq("id", pid).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  return NextResponse.json({ address: data.payout_address });
}
