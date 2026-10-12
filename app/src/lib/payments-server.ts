// Server-only: check a Base USDC payment to a claimant and record it once.
// Shared by /api/payments/verify (pasted or wallet tx) and /api/onramp/webhook (card payments).
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Hex } from "viem";
import { buildLine, type LineEntry } from "./claims";
import { checkUsdcPayment } from "./base";
import { CLAIM_COLUMNS, loadLine } from "./claims-server";
import { recordClaims } from "./eas";

export const PAYMENT_REASONS: Record<string, string> = {
  "tx-not-found": "Transaction not found on Base yet. Wait a minute and try again.",
  "tx-failed": "That transaction failed on Base",
  "no-usdc-transfer": "No USDC payment to this person in that transaction",
};

export type RecordResult =
  | { ok: true; amountUnits: bigint; blockTime: string; entries: LineEntry[] }
  | { ok: false; status: number; error: string; duplicate?: boolean };

/** `to` must be a lowercased 0x address and `txHash` a parsed hash. */
export async function recordUsdcPayment(db: SupabaseClient, to: string, txHash: Hex): Promise<RecordResult> {
  const claims = await db.from("pledger_claims").select(CLAIM_COLUMNS).eq("payout_address", to);
  if (claims.error) return { ok: false, status: 500, error: "Could not load" };
  if (!claims.data?.length) return { ok: false, status: 404, error: "This address is not in line" };

  const seen = await db.from("pledger_payments").select("tx_hash").eq("tx_hash", txHash.toLowerCase()).maybeSingle();
  if (seen.data) return { ok: false, status: 409, error: "This payment is already recorded", duplicate: true };

  const checked = await checkUsdcPayment(txHash, to);
  if (!checked.ok) return { ok: false, status: 400, error: PAYMENT_REASONS[checked.reason] ?? "Could not check that payment" };

  const ins = await db.from("pledger_payments").insert({
    tx_hash: checked.txHash,
    to_address: checked.to,
    amount_units: checked.amountUnits.toString(),
    block_number: Number(checked.blockNumber),
    block_time: checked.blockTime,
  });
  if (ins.error) {
    if (ins.error.code === "23505") return { ok: false, status: 409, error: "This payment is already recorded", duplicate: true };
    return { ok: false, status: 500, error: "Could not save the payment" };
  }

  // Public record for each of this person's claims once all of them are paid.
  const payments = await db.from("pledger_payments").select("tx_hash,to_address,amount_units,block_time").eq("to_address", to.toLowerCase());
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
  return { ok: true, amountUnits: checked.amountUnits, blockTime: checked.blockTime, entries: line.filter((e) => e.pid === mine[0]?.pid) };
}
