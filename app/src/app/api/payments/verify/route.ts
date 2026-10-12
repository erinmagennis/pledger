import { after, NextResponse } from "next/server";
import { buildLine, unitsToCents } from "@/lib/claims";
import { checkUsdcPayment, parseTxHash } from "@/lib/base";
import { CLAIM_COLUMNS, loadLine } from "@/lib/claims-server";
import { recordClaims } from "@/lib/eas";
import { DB_MISSING, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

const REASONS: Record<string, string> = {
  "tx-not-found": "Transaction not found on Base yet. Wait a minute and try again.",
  "tx-failed": "That transaction failed on Base",
  "no-usdc-transfer": "No USDC payment to this person in that transaction",
};

/** Check a Base mainnet USDC payment to a claimant and record it once. */
export async function POST(req: Request) {
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

  const claims = await db.from("pledger_claims").select(CLAIM_COLUMNS).eq("payout_address", to);
  if (claims.error) return bad("Could not load", 500);
  if (!claims.data?.length) return bad("This address is not in line", 404);

  const seen = await db.from("pledger_payments").select("tx_hash").eq("tx_hash", txHash).maybeSingle();
  if (seen.data) return bad("This payment is already recorded", 409);

  const checked = await checkUsdcPayment(txHash, to);
  if (!checked.ok) return bad(REASONS[checked.reason] ?? "Could not check that payment");

  const ins = await db.from("pledger_payments").insert({
    tx_hash: checked.txHash,
    to_address: checked.to,
    amount_units: checked.amountUnits.toString(),
    block_number: Number(checked.blockNumber),
    block_time: checked.blockTime,
  });
  if (ins.error) {
    if (ins.error.code === "23505") return bad("This payment is already recorded", 409);
    return bad("Could not save the payment", 500);
  }

  // Public record for each of this person's claims once all of them are paid.
  const payments = await db.from("pledger_payments").select("tx_hash,to_address,amount_units,block_time").eq("to_address", to);
  const mine = buildLine(claims.data as never, payments.data ?? []);
  const allPaid = mine.every((e) => e.status === "paid");
  if (allPaid) {
    after(() =>
      recordClaims(
        db,
        (claims.data ?? []).map((c: { id: string; fingerprint: string; project: string; fee_cents: number; self_backed: boolean }) => ({
          claimId: c.id,
          fingerprint: c.fingerprint,
          project: c.project,
          feeCents: c.fee_cents,
          selfBacked: c.self_backed,
          status: "paid",
          recipient: to,
        })),
      ),
    );
  }

  const line = await loadLine(db).catch(() => []);
  return NextResponse.json({
    recorded: true,
    amountCents: unitsToCents(checked.amountUnits),
    blockTime: checked.blockTime,
    entries: line.filter((e) => e.pid === mine[0]?.pid),
  });
}
