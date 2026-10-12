// Server-only claim pipeline: verify uploaded .eml files, pair self-backing, mark duplicates.
import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HOLD_MS, buildLine, friendlyReason, markHeld, markUnclaimable, parseExcludedHashes, toCents, MAX_FILES, type ClaimRecord, type LineEntry, type PaymentRecord, type HoldSource, type ReviewRow } from "./claims";
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

  return marked.map((r0, i): CheckedRow => {
    const feeCents = r0.kind === "receipt" && r0.endowmentFee !== undefined ? toCents(r0.endowmentFee) : undefined;
    // A $0 receipt would wait in line forever, so it cannot be claimed.
    const r = r0.ok && feeCents === 0 ? { ...r0, ok: false, reason: "no-fee" } : r0;
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
      feeCents,
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

/** True when an error means sql/005 (or a later file) has not run yet: a table or column is missing.
 * PostgREST answers PGRST204 (column) or PGRST205 (table); Postgres itself answers 42703 or 42P01. */
export function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (["PGRST204", "PGRST205", "42703", "42P01"].includes(error.code ?? "")) return true;
  return /schema cache|does not exist/i.test(error.message ?? "");
}

/** Stored payments, paid and extra. `select *` works before and after sql/005 adds `kind`. */
export async function readPayments(db: SupabaseClient, to?: string): Promise<PaymentRecord[]> {
  // Supabase returns 1000 rows by default; ask for up to 5000.
  const q = db.from("pledger_payments").select("*");
  const r = await (to ? q.eq("to_address", to) : q).range(0, 4999);
  if (r.error) throw new Error("db-read-failed");
  return ((r.data ?? []) as Record<string, unknown>[]).map((p) => ({
    tx_hash: String(p.tx_hash),
    to_address: String(p.to_address),
    amount_units: p.amount_units as string | number,
    block_time: String(p.block_time),
    kind: p.kind === "extra" ? "extra" : "paid",
  }));
}

async function readClaims(db: SupabaseClient): Promise<ClaimRecord[]> {
  const r = await db.from("pledger_claims").select(CLAIM_COLUMNS).order("created_at", { ascending: true }).range(0, 4999);
  if (r.error) throw new Error("db-read-failed");
  return (r.data ?? []) as unknown as ClaimRecord[];
}

/** The line plus the raw payments it was built from (the home tracker sums them; extras included, marked). */
export async function loadLineData(db: SupabaseClient): Promise<{ line: LineEntry[]; payments: PaymentRecord[] }> {
  const [claims, pays] = await Promise.all([readClaims(db), readPayments(db)]);
  return { line: buildLine(claims, pays), payments: pays };
}

/** Latest hold expiry per payout address, for holds still running at `now`. Holds are a courtesy:
 * before sql/005, or on any read error, nobody is held. */
export async function activeHolds(db: SupabaseClient, now = Date.now()): Promise<Map<string, string>> {
  const r = await db.from("pledger_holds").select("payout_address,expires_at").gt("expires_at", new Date(now).toISOString());
  if (r.error) {
    if (!isMissingSchema(r.error)) console.warn("[pledger] holds read failed", { code: r.error.code });
    return new Map();
  }
  const out = new Map<string, string>();
  for (const h of (r.data ?? []) as { payout_address: string; expires_at: string }[]) {
    const until = new Date(Date.parse(String(h.expires_at).replace(/(\.\d{3})\d+/, "$1")));
    if (!(until.getTime() > now)) continue;
    const a = String(h.payout_address).toLowerCase();
    const cur = out.get(a);
    if (!cur || until.toISOString() > cur) out.set(a, until.toISOString());
  }
  return out;
}

/** The public line with held people marked (`held`, `heldUntil`). Used by /api/line and the split. */
export async function loadLineWithHolds(db: SupabaseClient, now = Date.now()): Promise<LineEntry[]> {
  const [claims, pays, holds] = await Promise.all([readClaims(db), readPayments(db), activeHolds(db, now)]);
  const addressOf = new Map(claims.map((c) => [c.id, c.payout_address.toLowerCase()]));
  return markHeld(buildLine(claims, pays), addressOf, holds);
}

export type HoldResult = { ok: true; until: string } | { ok: false; missing: true } | { ok: false; missing?: false; error: string };

/** Hold these payout addresses for HOLD_MS. A new row per call; the latest expiry wins, so this also refreshes. */
export async function createHolds(db: SupabaseClient, addresses: string[], source: HoldSource, now = Date.now()): Promise<HoldResult> {
  const until = new Date(now + HOLD_MS).toISOString();
  const rows = [...new Set(addresses.map((a) => a.toLowerCase()))].map((payout_address) => ({ payout_address, expires_at: until, source }));
  if (!rows.length) return { ok: false, error: "Unknown person" };
  const r = await db.from("pledger_holds").insert(rows);
  if (r.error) return isMissingSchema(r.error) ? { ok: false, missing: true } : { ok: false, error: "Could not hold" };
  return { ok: true, until };
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
