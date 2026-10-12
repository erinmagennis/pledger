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

/** `txHash` on a pending result: a sent tx whose outcome is not known yet. It is kept on the row, so the
 * next retry looks it up instead of sending a second attestation. */
export type RecordResult = { state: "recorded"; uid: string; txHash?: string } | { state: "pending"; error: string; txHash?: string };

/** `txHash`: look this sent tx up instead of sending. `onSent`: called with the hash as soon as a new tx is
 * sent, before waiting for it, so a cut-off function still leaves the hash on the row. */
export type AttestOptions = { txHash?: string; onSent?: (txHash: string) => Promise<void> };

export function easConfigured(): boolean {
  return Boolean(process.env.PLEDGER_ATTESTER_KEY && process.env.PLEDGER_EAS_SCHEMA_UID);
}

const errText = (err: unknown) => (err instanceof Error ? err.message.slice(0, 200) : "attest-failed");

export async function attest(input: RecordInput, opts: AttestOptions = {}): Promise<RecordResult> {
  const key = process.env.PLEDGER_ATTESTER_KEY;
  const schemaUid = process.env.PLEDGER_EAS_SCHEMA_UID;
  if (!key || !schemaUid) return { state: "pending", error: "eas-not-configured", txHash: opts.txHash };
  let sent = opts.txHash;
  try {
    const [{ EAS, SchemaEncoder, NO_EXPIRATION }, { JsonRpcProvider, Wallet }] = await Promise.all([
      import("@ethereum-attestation-service/eas-sdk"),
      import("ethers"),
    ]);
    const provider = new JsonRpcProvider(process.env.BASE_RPC_URL || "https://mainnet.base.org", 8453);
    const signer = new Wallet(key, provider);
    const eas = new EAS(EAS_ADDRESS);
    eas.connect(signer);
    const uidOf = (receipt: Parameters<typeof eas.getUIDsFromAttestReceipt>[0]): RecordResult => {
      if (receipt.status !== 1) return { state: "pending", error: "attest-tx-reverted" };
      const uid = eas.getUIDsFromAttestReceipt(receipt)[0];
      return uid ? { state: "recorded", uid, txHash: receipt.hash } : { state: "pending", error: "attest-no-uid", txHash: receipt.hash };
    };
    if (opts.txHash) {
      // A try before this one sent a tx. Never send again while it may still land: read its outcome.
      const receipt = await provider.getTransactionReceipt(opts.txHash);
      if (receipt) return uidOf(receipt);
      // Unknown to the node too: the tx was dropped, so the hash is cleared and the next retry sends again.
      if (!(await provider.getTransaction(opts.txHash))) return { state: "pending", error: "attest-tx-dropped" };
      return { state: "pending", error: "attest-tx-not-mined", txHash: opts.txHash };
    }
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
    // The SDK's tx.wait() sends and waits in one step. Send here instead, so the hash is stored first.
    const res = await signer.sendTransaction(tx.data);
    sent = res.hash;
    await opts.onSent?.(res.hash).catch(() => undefined);
    const receipt = await res.wait();
    if (!receipt) return { state: "pending", error: "attest-not-confirmed", txHash: sent };
    return uidOf(receipt);
  } catch (err) {
    return { state: "pending", error: errText(err), txHash: sent };
  }
}

/** A placeholder whose run has not finished may belong to a request still attesting it. Past this age it is
 * taken as stuck (the function was cut off) and is retried. */
export const STUCK_MS = 10 * 60 * 1000;

/** The error a row carries while a run is attesting it: the start time, then a random tag. This is the run's
 * ownership token: every later write by that run is guarded on it, so a late writer cannot overwrite a newer run. */
const RETRYING = "retrying since ";

const runToken = (now: number) => `${RETRYING}${new Date(now).toISOString()} ${Math.random().toString(36).slice(2, 10)}`;

type Slot = { state?: string; error?: string | null; created_at?: string; tx_hash?: string | null };

/** True when an existing (claim_id, status) row should be attested again: pending, and either a finished
 * failed try (error set) or a run old enough to be stuck. A recorded row, or a fresh run, is left alone. */
export function retryable(slot: Slot, now = Date.now()): boolean {
  if (slot.state !== "pending") return false;
  // A run in flight carries its start time, so it is left alone until it too looks stuck.
  // Rows from before run tokens carry no error while in flight: their created_at is the start time.
  const busy = slot.error?.startsWith(RETRYING) ? slot.error.slice(RETRYING.length).split(" ")[0] : !slot.error ? slot.created_at : null;
  if (busy === null) return true; // a finished try that failed
  const at = busy ? Date.parse(busy) : NaN;
  return Number.isFinite(at) && now - at > STUCK_MS;
}

/** Attest each claim in turn and store the outcome. Errors are swallowed into "pending" rows.
 * Each claim and status is recorded at most once: the existing row is read first and a recorded one is never
 * attested again; with no row, a placeholder is inserted (the unique index from sql/004 lets only one of two
 * racing inserts through; before 004 the read first still stops repeat calls). A pending row is retried in
 * place, taken first with a compare-and-set so two racing retries attest once. A sent tx hash is stored before
 * waiting, so a retry looks that tx up instead of sending a second attestation. */
export async function recordClaims(db: SupabaseClient, inputs: RecordInput[], doAttest: typeof attest = attest, now = Date.now()): Promise<void> {
  for (const input of inputs) {
    try {
      const slot = await takeSlot(db, input, now);
      if (!slot) continue;
      const r = await doAttest(input, {
        txHash: slot.txHash ?? undefined,
        onSent: async (txHash) => {
          await db.from("pledger_attestations").update({ tx_hash: txHash }).eq("claim_id", input.claimId).eq("status", input.status).eq("error", slot.token);
        },
      });
      const done = await db
        .from("pledger_attestations")
        .update({
          state: r.state,
          uid: r.state === "recorded" ? r.uid : null,
          tx_hash: r.txHash ?? null,
          error: r.state === "pending" ? r.error : null,
        })
        .eq("claim_id", input.claimId)
        .eq("status", input.status)
        .eq("error", slot.token)
        .select("claim_id");
      // Another run took the row over (this one looked stuck): its outcome wins, so leave the claim alone.
      if (done.error || !(done.data?.length ?? 0)) continue;
      await db.from("pledger_claims").update({ record_state: r.state }).eq("id", input.claimId);
    } catch {
      // keep going; the claim itself is already stored
    }
  }
}

/** Own the (claim_id, status) row for this run, or null to skip it: recorded, in flight, unreadable or taken.
 * Returns the run's token and any tx hash an earlier try already sent. */
async function takeSlot(db: SupabaseClient, input: RecordInput, now: number): Promise<{ token: string; txHash?: string | null } | null> {
  const token = runToken(now);
  const read = await readSlot(db, input);
  if (read === "error") return null; // cannot tell what is recorded: never risk a second attestation
  if (!read) {
    const ins = await db.from("pledger_attestations").insert({
      claim_id: input.claimId,
      fingerprint: input.fingerprint,
      status: input.status,
      state: "pending",
      error: token,
    });
    if (!ins.error) return { token };
    if (ins.error.code !== "23505") {
      console.warn("[pledger] attestation slot not saved", { claimId: input.claimId, status: input.status, code: ins.error.code });
      return null;
    }
    // 23505: another request inserted it first (sql/004). Read it again and retry only if it is pending.
    const again = await readSlot(db, input);
    if (again === "error" || !again) return null;
    return claimRetry(db, input, again, token, now);
  }
  return claimRetry(db, input, read, token, now);
}

async function readSlot(db: SupabaseClient, input: RecordInput): Promise<Slot | null | "error"> {
  const r = await db
    .from("pledger_attestations")
    .select("state, error, created_at, tx_hash")
    .eq("claim_id", input.claimId)
    .eq("status", input.status)
    .limit(1)
    .maybeSingle();
  if (r.error) return "error";
  return (r.data as Slot | null) ?? null;
}

/** When the row is worth retrying, take it with a compare-and-set on its error (set to this run's token),
 * so only one request re-attests. */
async function claimRetry(db: SupabaseClient, input: RecordInput, row: Slot, token: string, now: number): Promise<{ token: string; txHash?: string | null } | null> {
  if (!retryable(row, now)) return null;
  const q = db
    .from("pledger_attestations")
    .update({ error: token })
    .eq("claim_id", input.claimId)
    .eq("status", input.status)
    .eq("state", "pending");
  const took = await (row.error ? q.eq("error", row.error) : q.is("error", null)).select("claim_id");
  if (took.error || !(took.data?.length ?? 0)) return null;
  return { token, txHash: row.tx_hash };
}
