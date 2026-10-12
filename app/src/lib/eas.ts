// Public records on Base mainnet EAS. Never blocks a claim: on missing env or a failed tx
// the record is kept as "pending" and can be retried later.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const EAS_ADDRESS = "0x4200000000000000000000000000000000000021";
export const SCHEMA_REGISTRY_ADDRESS = "0x4200000000000000000000000000000000000020";
export const CLAIM_SCHEMA = "bytes32 fingerprint,string project,uint256 feeCents,bool selfBacked,string status";

export type RecordInput = {
  claimId: string;
  fingerprint: string;
  project: string;
  feeCents: number;
  selfBacked: boolean;
  status: string;
  recipient: string;
};

export type RecordResult = { state: "recorded"; uid: string; txHash?: string } | { state: "pending"; error: string };

export function easConfigured(): boolean {
  return Boolean(process.env.PLEDGER_ATTESTER_KEY && process.env.PLEDGER_EAS_SCHEMA_UID);
}

export async function attest(input: RecordInput): Promise<RecordResult> {
  const key = process.env.PLEDGER_ATTESTER_KEY;
  const schemaUid = process.env.PLEDGER_EAS_SCHEMA_UID;
  if (!key || !schemaUid) return { state: "pending", error: "eas-not-configured" };
  try {
    const [{ EAS, SchemaEncoder, NO_EXPIRATION }, { JsonRpcProvider, Wallet }] = await Promise.all([
      import("@ethereum-attestation-service/eas-sdk"),
      import("ethers"),
    ]);
    const provider = new JsonRpcProvider(process.env.BASE_RPC_URL || "https://mainnet.base.org", 8453);
    const signer = new Wallet(key, provider);
    const eas = new EAS(EAS_ADDRESS);
    eas.connect(signer);
    const data = new SchemaEncoder(CLAIM_SCHEMA).encodeData([
      { name: "fingerprint", value: "0x" + input.fingerprint, type: "bytes32" },
      { name: "project", value: input.project, type: "string" },
      { name: "feeCents", value: BigInt(input.feeCents), type: "uint256" },
      { name: "selfBacked", value: input.selfBacked, type: "bool" },
      { name: "status", value: input.status, type: "string" },
    ]);
    const tx = await eas.attest({
      schema: schemaUid,
      data: { recipient: input.recipient, expirationTime: NO_EXPIRATION, revocable: true, data },
    });
    const uid = await tx.wait();
    return { state: "recorded", uid, txHash: tx.receipt?.hash };
  } catch (err) {
    return { state: "pending", error: err instanceof Error ? err.message.slice(0, 200) : "attest-failed" };
  }
}

/** A placeholder with no error yet may belong to a request still attesting it. Past this age it is taken as stuck
 * (the function was cut off after the slot insert) and is retried. */
export const STUCK_MS = 10 * 60 * 1000;

/** The error a row carries while a retry is attesting it, followed by the start time. */
const RETRYING = "retrying since ";

type Slot = { state?: string; error?: string | null; created_at?: string };

/** True when an existing (claim_id, status) row should be attested again: pending, and either a finished
 * failed try (error set) or a placeholder old enough to be stuck. A recorded row, or a fresh placeholder, is left alone. */
export function retryable(slot: Slot, now = Date.now()): boolean {
  if (slot.state !== "pending") return false;
  // A retry in flight carries its start time, so it is left alone until it too looks stuck.
  const busy = slot.error?.startsWith(RETRYING) ? slot.error.slice(RETRYING.length) : !slot.error ? slot.created_at : null;
  if (busy === null) return true; // a finished try that failed
  const at = busy ? Date.parse(busy) : NaN;
  return Number.isFinite(at) && now - at > STUCK_MS;
}

/** Attest each claim in turn and store the outcome. Errors are swallowed into "pending" rows.
 * Each claim and status is recorded at most once: a recorded row is never attested again, and a pending row
 * is retried in place, claimed first with a compare-and-set so two racing retries attest once. */
export async function recordClaims(db: SupabaseClient, inputs: RecordInput[], doAttest: typeof attest = attest, now = Date.now()): Promise<void> {
  for (const input of inputs) {
    try {
      // Claim the slot first with a placeholder row. This relies on the unique index on
      // (claim_id, status) from sql/004: of two requests racing here, only one insert succeeds,
      // so only one sends an on-chain attestation. 23505 means a row exists: retry it only if it is pending.
      const slot = await db.from("pledger_attestations").insert({
        claim_id: input.claimId,
        fingerprint: input.fingerprint,
        status: input.status,
        state: "pending",
      });
      if (slot.error) {
        if (slot.error.code !== "23505") {
          console.warn("[pledger] attestation slot not saved", { claimId: input.claimId, status: input.status, code: slot.error.code });
          continue;
        }
        if (!(await claimRetry(db, input, now))) continue;
      }
      const r = await doAttest(input);
      await db
        .from("pledger_attestations")
        .update({
          state: r.state,
          uid: r.state === "recorded" ? r.uid : null,
          tx_hash: r.state === "recorded" ? r.txHash ?? null : null,
          error: r.state === "pending" ? r.error : null,
        })
        .eq("claim_id", input.claimId)
        .eq("status", input.status);
      await db.from("pledger_claims").update({ record_state: r.state }).eq("id", input.claimId);
    } catch {
      // keep going; the claim itself is already stored
    }
  }
}

/** Read the existing row and, when it is worth retrying, take it with a compare-and-set on its error
 * (set to "retrying since <time>"), so only one request re-attests. False means skip: recorded, fresh, unreadable or taken. */
async function claimRetry(db: SupabaseClient, input: RecordInput, now: number): Promise<boolean> {
  const read = await db
    .from("pledger_attestations")
    .select("state, error, created_at")
    .eq("claim_id", input.claimId)
    .eq("status", input.status)
    .maybeSingle();
  if (read.error || !read.data) return false; // cannot tell what is recorded: never risk a second attestation
  const row = read.data as Slot;
  if (!retryable(row, now)) return false;
  const q = db
    .from("pledger_attestations")
    .update({ error: RETRYING + new Date(now).toISOString() })
    .eq("claim_id", input.claimId)
    .eq("status", input.status)
    .eq("state", "pending");
  const took = await (row.error ? q.eq("error", row.error) : q.is("error", null)).select("claim_id");
  return !took.error && (took.data?.length ?? 0) > 0;
}
