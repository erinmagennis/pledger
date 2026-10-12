// Server-only: check a Base USDC payment to a claimant and record it once.
// Shared by /api/payments/verify (pasted or wallet tx) and /api/onramp/webhook (card payments).
import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Hex } from "viem";
import { buildLine, centsToUnits, type ClaimRecord, type LineEntry, type PaymentRecord } from "./claims";
import { checkPaymentRule, checkUsdcPayment } from "./base";
import { CLAIM_COLUMNS, loadLine } from "./claims-server";
import { recordClaims, type RecordInput } from "./eas";

export const PAYMENT_REASONS: Record<string, string> = {
  "tx-not-found": "Transaction not found on Base yet. Wait a minute and try again.",
  "tx-failed": "That transaction failed on Base",
  "no-usdc-transfer": "No USDC payment to this person in that transaction",
  "self-transfer": "A wallet cannot pay itself",
};

const ALREADY = "This payment is already recorded";
/** Shown when one tx pays several people before sql/003_pledger_payments_per_recipient.sql has run. */
export const NEEDS_003 = "Batch payments need the 003 update";

export type RecordResult =
  | { ok: true; amountUnits: bigint; blockTime: string; entries: LineEntry[] }
  | { ok: false; status: number; error: string; duplicate?: boolean };

/** What one person still owes, in USDC units: fee minus paid over their unpaid and partial entries.
 * A forgiven entry (paid at 99.5% or more) is "paid" in buildLine, so it adds 0 here. */
export function owedUnits(entries: LineEntry[]): bigint {
  return entries.reduce((s, e) => (e.status === "paid" ? s : s + centsToUnits(Math.max(0, e.feeCents - e.paidCents))), 0n);
}

export const allPaid = (entries: LineEntry[]) => entries.length > 0 && entries.every((e) => e.status === "paid");

/** Swappable in tests. */
export type PaymentDeps = {
  check: typeof checkUsdcPayment;
  attest: (db: SupabaseClient, inputs: RecordInput[]) => Promise<void>;
  later: (fn: () => Promise<void>) => void;
};

const DEPS: PaymentDeps = { check: (h, to) => checkUsdcPayment(h, to), attest: recordClaims, later: after };

const PAY_COLUMNS = "tx_hash,to_address,amount_units,block_time";

/** `to` must be a lowercased 0x address and `txHash` a parsed hash. */
export async function recordUsdcPayment(db: SupabaseClient, to: string, txHash: Hex, deps: Partial<PaymentDeps> = {}): Promise<RecordResult> {
  const { check, attest, later } = { ...DEPS, ...deps };
  const claims = await db.from("pledger_claims").select(CLAIM_COLUMNS).eq("payout_address", to);
  if (claims.error) return { ok: false, status: 500, error: "Could not load" };
  if (!claims.data?.length) return { ok: false, status: 404, error: "This address is not in line" };
  const mineClaims = claims.data as unknown as ClaimRecord[];

  // One tx can pay several people (batch payouts), so a payment is unique per (tx_hash, to_address).
  const seen = await db.from("pledger_payments").select("tx_hash").eq("tx_hash", txHash.toLowerCase()).eq("to_address", to).maybeSingle();
  if (seen.data) return { ok: false, status: 409, error: ALREADY, duplicate: true };

  const checked = await check(txHash, to);
  if (!checked.ok) return { ok: false, status: 400, error: PAYMENT_REASONS[checked.reason] ?? "Could not check that payment" };

  // The rule: sent after the first claim, and the full remaining amount give or take 0.5%.
  const before = await db.from("pledger_payments").select(PAY_COLUMNS).eq("to_address", to);
  if (before.error) return { ok: false, status: 500, error: "Could not load" };
  const linesBefore = buildLine(mineClaims, (before.data ?? []) as PaymentRecord[]);
  const firstClaimAt = mineClaims.reduce((m, c) => (c.created_at < m ? c.created_at : m), mineClaims[0]!.created_at);
  const owed = owedUnits(linesBefore);
  const rule = checkPaymentRule({ blockTime: checked.blockTime, firstClaimAt, amountUnits: checked.amountUnits, owedUnits: owed });
  if (!rule.ok) {
    // Real money on Base that the rule turned away: one line in the server logs so it can be followed up by hand.
    console.warn("[pledger] payment rejected", { txHash: checked.txHash, to, reason: rule.error, amountUnits: checked.amountUnits.toString(), owedUnits: owed.toString() });
    return { ok: false, status: 400, error: rule.error };
  }

  const ins = await db.from("pledger_payments").insert({
    tx_hash: checked.txHash,
    to_address: checked.to,
    amount_units: checked.amountUnits.toString(),
    block_number: Number(checked.blockNumber),
    block_time: checked.blockTime,
  });
  if (ins.error) {
    if (ins.error.code === "23505") {
      // Same tx and person: already recorded. Same tx, other person: the old per-tx rule (before sql/003) blocked it.
      const again = await db.from("pledger_payments").select("tx_hash").eq("tx_hash", checked.txHash).eq("to_address", checked.to).maybeSingle();
      if (again.data) return { ok: false, status: 409, error: ALREADY, duplicate: true };
      return { ok: false, status: 409, error: NEEDS_003 };
    }
    return { ok: false, status: 500, error: "Could not save the payment" };
  }

  // Public record for each of this person's claims, only on the step from not-all-paid to all-paid.
  const payments = await db.from("pledger_payments").select(PAY_COLUMNS).eq("to_address", to);
  const mine = buildLine(mineClaims, (payments.data ?? []) as PaymentRecord[]);
  if (!allPaid(linesBefore) && allPaid(mine)) {
    later(() =>
      attest(
        db,
        mineClaims.map((c) => ({
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
