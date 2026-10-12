// Server-only claim pipeline: verify uploaded .eml files, pair self-backing, mark duplicates.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLine, friendlyReason, markUnclaimable, parseExcludedHashes, toCents, MAX_FILES, type ClaimRecord, type LineEntry, type PaymentRecord, type ReviewRow } from "./claims";
import { verifyArtizenEmail, pairSelfBacked, MAX_BYTES, type Result as VerifyResult } from "./verify";

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");
export const hashEmail = (email: string) => sha256Hex(email.trim().toLowerCase());

export type Upload = { name: string; data: Buffer };

/** Full server view of a verified email. `toHash` never leaves the server except into the DB. */
export type CheckedRow = ReviewRow & { toHash?: string; contribution?: number };

export async function readUploads(form: FormData): Promise<Upload[] | { error: string }> {
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (!files.length) return { error: "No files sent" };
  if (files.length > MAX_FILES) return { error: `Up to ${MAX_FILES} files at a time` };
  const out: Upload[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) {
      out.push({ name: f.name, data: Buffer.alloc(0) });
      continue;
    }
    out.push({ name: f.name.slice(0, 120), data: Buffer.from(await f.arrayBuffer()) });
  }
  return out;
}

export async function existingFingerprints(db: SupabaseClient | null, fps: string[]): Promise<Set<string>> {
  if (!db || !fps.length) return new Set();
  const { data, error } = await db.from("pledger_claims").select("fingerprint").in("fingerprint", fps);
  if (error) throw new Error("db-read-failed");
  return new Set((data ?? []).map((r: { fingerprint: string }) => r.fingerprint));
}

/** Verify every file, then mark duplicates / excluded receipts, then pair self-backing. */
export async function checkUploads(uploads: Upload[], db: SupabaseClient | null): Promise<CheckedRow[]> {
  const results: VerifyResult[] = await Promise.all(
    uploads.map(async (u) => {
      if (!u.data.length) return { ok: false, reason: "too-large" } as VerifyResult;
      try {
        return await verifyArtizenEmail(u.data);
      } catch {
        return { ok: false, reason: "dkim-error" } as VerifyResult;
      }
    }),
  );

  const withHash = results.map((r) => ({ ...r, toHash: r.to ? hashEmail(r.to) : undefined }));
  const fps = withHash.map((r) => r.fingerprint).filter((f): f is string => Boolean(f));
  const existing = await existingFingerprints(db, fps);
  const marked = markUnclaimable(withHash, existing, parseExcludedHashes(process.env.PLEDGER_EXCLUDED_EMAIL_HASHES));

  const receipts = marked.filter((r) => r.ok && r.kind === "receipt");
  const solds = marked.filter((r) => r.ok && r.kind === "sold");
  const paired = pairSelfBacked(receipts, solds).receipts;
  const selfBacked = new Set(paired.filter((p) => p.selfBacked).map((p) => p.fingerprint));

  return marked.map((r, i): CheckedRow => {
    const f = r.ok ? { message: r.kind === "sold" ? "Sale email, used to check self-backing" : "" } : friendlyReason(r.reason);
    return {
      file: uploads[i]!.name,
      kind: (r.kind ?? "other") as CheckedRow["kind"],
      ok: r.ok,
      reason: r.ok ? undefined : r.reason,
      message: f.message,
      showHelp: "showHelp" in f ? f.showHelp : undefined,
      fingerprint: r.fingerprint,
      date: r.date,
      project: r.project,
      feeCents: r.kind === "receipt" && r.endowmentFee !== undefined ? toCents(r.endowmentFee) : undefined,
      selfBacked: r.kind === "receipt" ? selfBacked.has(r.fingerprint) : undefined,
      toHash: r.toHash,
      contribution: r.contribution,
    };
  });
}

/** Strip server-only fields before sending rows to the browser. */
export function publicRow(r: CheckedRow): ReviewRow {
  const { toHash: _h, contribution: _c, ...rest } = r;
  return rest;
}

export const CLAIM_COLUMNS = "id,fingerprint,project,purchased_at,fee_cents,self_backed,payout_address,display_mode,display_name,created_at";

/** The line plus the raw payments it was built from (the home tracker sums them). */
export async function loadLineData(db: SupabaseClient): Promise<{ line: LineEntry[]; payments: PaymentRecord[] }> {
  const [claims, payments] = await Promise.all([
    db.from("pledger_claims").select(CLAIM_COLUMNS).order("created_at", { ascending: true }),
    db.from("pledger_payments").select("tx_hash,to_address,amount_units,block_time"),
  ]);
  if (claims.error || payments.error) throw new Error("db-read-failed");
  const pays = (payments.data ?? []) as PaymentRecord[];
  return { line: buildLine((claims.data ?? []) as ClaimRecord[], pays), payments: pays };
}

export async function loadLine(db: SupabaseClient) {
  return (await loadLineData(db)).line;
}

/** Full payout address for one person (pid = their earliest claim id). Server only. */
export async function payoutAddressFor(db: SupabaseClient, pid: string): Promise<{ address: string } | { error: string; status: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(pid)) return { error: "Unknown person", status: 400 };
  const { data, error } = await db.from("pledger_claims").select("payout_address").eq("id", pid).maybeSingle();
  if (error) return { error: "Could not load", status: 500 };
  if (!data) return { error: "Unknown person", status: 404 };
  return { address: String(data.payout_address).toLowerCase() };
}

/** Full payout addresses for many people at once (pid -> address). Server only. */
export async function payoutAddressesFor(db: SupabaseClient, pids: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(pids)].filter((p) => /^[0-9a-f-]{36}$/i.test(p));
  if (!ids.length) return new Map();
  const { data, error } = await db.from("pledger_claims").select("id,payout_address").in("id", ids);
  if (error) throw new Error("db-read-failed");
  return new Map((data ?? []).map((r: { id: string; payout_address: string }) => [r.id, String(r.payout_address).toLowerCase()]));
}
