import { NextResponse } from "next/server";
import { summarize } from "@/lib/claims";
import { checkUploads, publicRow, readUploads } from "@/lib/claims-server";
import { ipOf, limit, tooMany, TEN_MIN } from "@/lib/ratelimit";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verify uploaded .eml files. Stores nothing. Works without a database (skips the duplicate check). */
export async function POST(req: Request) {
  if (!limit("claims-verify", ipOf(req), 20, TEN_MIN)) return tooMany();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the files as a form upload" }, { status: 400 });
  }
  const uploads = await readUploads(form);
  if ("error" in uploads) return NextResponse.json({ error: uploads.error }, { status: 400 });
  const db = getSupabase();
  try {
    const rows = (await checkUploads(uploads, db)).map(publicRow);
    return NextResponse.json({ rows, summary: summarize(rows), dbConnected: Boolean(db) });
  } catch {
    return NextResponse.json({ error: "Could not check the files. Try again." }, { status: 500 });
  }
}
