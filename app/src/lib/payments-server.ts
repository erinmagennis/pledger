// Server-only: check a Base USDC payment to a claimant and record it once.
// Shared by /api/payments/verify (pasted or wallet tx) and /api/onramp/webhook (card payments).
import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Hex } from "viem";
import { buildLine, centsToUnits, type ClaimRecord, type LineEntry } from "./claims";
import { SENT_BEFORE, checkPaymentRule, checkUsdcPayment, dollars } from "./base";
import { CLAIM_COLUMNS, EXTRAS_PER_ADDRESS, isMissingSchema, loadLine, readPayments } from "./claims-server";
import { recordClaims, type RecordInput } from "./eas";

export const PAYMENT_REASONS: Record<string, string> = {
  "tx-not-found": "Transaction not found on Base yet. Wait a minute and try again.",
  "tx-failed": "That transaction failed on Base",
  "no-usdc-transfer": "No USDC payment to this person in that transaction",
  "self-transfer": "A wallet cannot pay itself",
};

const ALREADY = "This payment is already recorded";
/** Smallest extra that is stored: $1.00 in USDC units. */
export const MIN_EXTRA_UNITS = 1_000_000n;
/** Shown when one tx pays several people before sql/003_pledger_payments_per_recipient.sql has run. */
export const NEEDS_003 = "Batch payments need the 003 update";

/** What the payer sees when real money arrived but did not match what the person is owed. */
export const extraMessage = (owed: bigint) => `Recorded as extra: it does not match what this person is owed (${dollars(owed > 0n ? owed : 0n)})`;

export type RecordResult =
  | { ok: true; amountUnits: bigint; blockTime: string; entries: LineEntry[]; extra?: { message: string } }
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
  // Extras are left out here (buildLine skips them), so they never change what is owed.
  let before;
  try {
    before = await readPayments(db, to);
  } catch {
    return { ok: false, status: 500, error: "Could not load" };
  }
  const linesBefore = buildLine(mineClaims, before);
  const firstClaimAt = mineClaims.reduce((m, c) => (c.created_at < m ? c.created_at : m), mineClaims[0]!.created_at);
  const owed = owedUnits(linesBefore);
  const rule = checkPaymentRule({ blockTime: checked.blockTime, firstClaimAt, amountUnits: checked.amountUnits, owedUnits: owed });
  if (!rule.ok) {
    // Real money on Base that the rule turned away: one line in the server logs so it can be followed up by hand.
    console.warn("[pledger] payment rejected", { txHash: checked.txHash, to, reason: rule.error, amountUnits: checked.amountUnits.toString(), owedUnits: owed.toString() });
    // Sent before the claim stays rejected. A wrong amount is stored as an extra (sql/005), shown on the
    // person's row and never counted. Before 005 the insert fails on the unknown column: reject as before.
    if (rule.error === SENT_BEFORE) return { ok: false, status: 400, error: rule.error };
    // Dust and floods: an extra under $1.00, or past 5 per person, is turned away (and logged), not stored.
    if (checked.amountUnits < MIN_EXTRA_UNITS) {
      console.warn("[pledger] extra not saved", { txHash: checked.txHash, to, reason: "under-minimum" });
      return { ok: false, status: 400, error: rule.error };
    }
    if (before.filter((p) => p.kind === "extra").length >= EXTRAS_PER_ADDRESS) {
      console.warn("[pledger] extra not saved", { txHash: checked.txHash, to, reason: "extras-full" });
      return { ok: false, status: 400, error: rule.error };
    }
    const extra = await db.from("pledger_payments").insert({ ...row(checked), kind: "extra" });
    if (extra.error) {
      if (extra.error.code === "23505") return duplicateOrNeeds003(db, checked.txHash, checked.to);
      // Before sql/005 the unknown column fails: reject as before. Anything else is an outage.
      if (isMissingSchema(extra.error)) return { ok: false, status: 400, error: rule.error };
      console.warn("[pledger] extra not saved", { txHash: checked.txHash, code: extra.error.code });
      return { ok: false, status: 500, error: "Could not save the payment" };
    }
    const line = await loadLine(db).catch(() => []);
    const pid = linesBefore[0]?.pid;
    return { ok: true, amountUnits: checked.amountUnits, blockTime: checked.blockTime, entries: line.filter((e) => e.pid === pid), extra: { message: extraMessage(owed) } };
  }

  const ins = await db.from("pledger_payments").insert(row(checked));
  if (ins.error) {
    if (ins.error.code === "23505") return duplicateOrNeeds003(db, checked.txHash, checked.to);
    return { ok: false, status: 500, error: "Could not save the payment" };
  }

  // Public record for each of this person's claims, only on the step from not-all-paid to all-paid.
  // Extras are never in `mine`'s paid amounts, so an extra can never trigger a record.
  const mine = buildLine(mineClaims, await readPayments(db, to).catch(() => []));
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

type Checked = Extract<Awaited<ReturnType<typeof checkUsdcPayment>>, { ok: true }>;

const row = (c: Checked) => ({
  tx_hash: c.txHash,
  to_address: c.to,
  amount_units: c.amountUnits.toString(),
  block_number: Number(c.blockNumber),
  block_time: c.blockTime,
});

/** Same tx and person: already recorded. Same tx, other person: the old per-tx rule (before sql/003) blocked it. */
async function duplicateOrNeeds003(db: SupabaseClient, txHash: string, to: string): Promise<RecordResult> {
  const again = await db.from("pledger_payments").select("tx_hash").eq("tx_hash", txHash).eq("to_address", to).maybeSingle();
  if (again.data) return { ok: false, status: 409, error: ALREADY, duplicate: true };
  return { ok: false, status: 409, error: NEEDS_003 };
}
