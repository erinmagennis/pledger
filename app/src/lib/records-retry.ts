// Server-only: finish public records that never got done. A record is attested after the answer is sent
// (after()), so a function cut off mid-way, or an RPC outage, can leave it pending, or leave an all-paid
// person with no "paid" record at all. This sweeps both, at most once per RETRY_EVERY_MS per server instance.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLine, type ClaimRecord } from "./claims";
import { readClaims, readPayments } from "./claims-server";
import { STUCK_MS, easConfigured, recordClaims, type RecordInput } from "./eas";
import { allPaid, paidInputs } from "./payments-server";

export const RETRY_EVERY_MS = 5 * 60 * 1000;
/** Most records sent per sweep: each one waits for a Base tx, and the sweep runs inside one request. */
export const RETRY_BATCH = 10;

let lastRun = 0;

/** For tests: let the next call run. */
export function resetRetryThrottle() {
  lastRun = 0;
}

export type RetryDeps = { record: typeof recordClaims; configured: () => boolean };
const DEPS: RetryDeps = { record: recordClaims, configured: easConfigured };

const inputOf = (c: ClaimRecord, status: string): RecordInput => ({
  claimId: c.id,
  fingerprint: c.fingerprint,
  project: c.project,
  feeCents: c.fee_cents,
  selfBacked: c.self_backed,
  status,
  recipient: c.payout_address.toLowerCase(),
});

/** Retry pending records older than STUCK_MS and add the missing "paid" records of all-paid people.
 * Returns how many records were handed to recordClaims (0 when throttled, not set up, or nothing to do).
 * recordClaims itself skips recorded rows and rows another run is still working on. */
export async function retryStuckRecords(db: SupabaseClient, deps: Partial<RetryDeps> = {}, now = Date.now()): Promise<number> {
  const { record, configured } = { ...DEPS, ...deps };
  if (now - lastRun < RETRY_EVERY_MS) return 0;
  lastRun = now;
  if (!configured()) return 0; // without EAS keys every try fails: do not churn rows
  try {
    const [claims, pays, stuck, paidRows] = await Promise.all([
      readClaims(db),
      readPayments(db),
      db
        .from("pledger_attestations")
        .select("claim_id,status,created_at")
        .eq("state", "pending")
        .lt("created_at", new Date(now - STUCK_MS).toISOString())
        .order("created_at", { ascending: true })
        .limit(RETRY_BATCH),
      db.from("pledger_attestations").select("claim_id").eq("status", "paid").range(0, 4999),
    ]);
    if (stuck.error || paidRows.error) return 0;
    const byId = new Map(claims.map((c) => [c.id, c]));
    const inputs: RecordInput[] = [];
    const seen = new Set<string>();
    const push = (i: RecordInput) => {
      const k = `${i.claimId}|${i.status}`;
      if (seen.has(k) || inputs.length >= RETRY_BATCH) return;
      seen.add(k);
      inputs.push(i);
    };
    for (const r of (stuck.data ?? []) as { claim_id: string; status: string }[]) {
      const c = byId.get(r.claim_id);
      if (c) push(inputOf(c, r.status));
    }
    // All-paid people with a claim that has no "paid" row at all.
    const hasPaid = new Set(((paidRows.data ?? []) as { claim_id: string }[]).map((r) => r.claim_id));
    const byAddress = new Map<string, ClaimRecord[]>();
    for (const c of claims) {
      const a = c.payout_address.toLowerCase();
      byAddress.set(a, [...(byAddress.get(a) ?? []), c]);
    }
    for (const [address, mine] of byAddress) {
      if (inputs.length >= RETRY_BATCH) break;
      if (mine.every((c) => hasPaid.has(c.id))) continue;
      if (!allPaid(buildLine(mine, pays.filter((p) => p.to_address.toLowerCase() === address)))) continue;
      for (const i of paidInputs(mine, address)) if (!hasPaid.has(i.claimId)) push(i);
    }
    if (inputs.length) await record(db, inputs, undefined, now);
    return inputs.length;
  } catch {
    return 0; // a sweep is best effort; the next one tries again
  }
}
