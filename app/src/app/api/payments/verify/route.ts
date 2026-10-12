import { NextResponse } from "next/server";
import { unitsToCents } from "@/lib/claims";
import { parseTxHash } from "@/lib/base";
import { recordUsdcPayment } from "@/lib/payments-server";
import { ipOf, limit, tooMany, TEN_MIN } from "@/lib/ratelimit";
import { DB_MISSING, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Check a Base mainnet USDC payment to a claimant and record it once. */
export async function POST(req: Request) {
  // 120, not 30: one batch records up to 50 people one call each, and helpers at one venue share an IP.
  if (!limit("payments-verify", ipOf(req), 120, TEN_MIN)) return tooMany();
  const db = getSupabase();
  if (!db) return NextResponse.json(DB_MISSING, { status: 503 });
  let body: { claimAddress?: string; txHash?: string };
  try {
    body = await req.json();
  } catch {
    return bad("Send claimAddress and txHash");
  }
  const to = String(body.claimAddress ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(to)) return bad("Unknown person");
  const txHash = parseTxHash(String(body.txHash ?? ""));
  if (!txHash) return bad("Paste a Base transaction link or hash");

  const r = await recordUsdcPayment(db, to, txHash);
  if (!r.ok) return bad(r.error, r.status);

  return NextResponse.json({
    recorded: true,
    // Set when the money arrived but did not match what is owed: stored as an extra, never counted.
    ...(r.extra ? { kind: "extra", message: r.extra.message } : { kind: "paid" }),
    amountCents: unitsToCents(r.amountUnits),
    blockTime: r.blockTime,
    entries: r.entries,
  });
}
