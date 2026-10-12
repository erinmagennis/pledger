// Server-only claim pipeline: verify uploaded .eml files, pair self-backing, mark duplicates.
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HOLD_MS, buildLine, byClaimTime, friendlyReason, markHeld, markUnclaimable, parseExcludedHashes, toCents, MAX_FILES, type ClaimRecord, type LineEntry, type PaymentRecord, type HoldSource, type ReviewRow } from "./claims";
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

const MISSING_SCHEMA_CODES = ["PGRST204", "PGRST205", "42703", "42P01"];

/** True when an error means sql/005 (or a later file) has not run yet: a table or column is missing.
 * PostgREST answers PGRST204 (column) or PGRST205 (table); Postgres itself answers 42703 or 42P01.
 * Codes only: a message match could turn a real outage into "not set up yet". */
export function isMissingSchema(error: { code?: string } | null | undefined): boolean {
  return !!error && MISSING_SCHEMA_CODES.includes(error.code ?? "");
}

/** Newest extras read at most, across everyone, and kept per person. Extras are shown, never counted. */
export const EXTRAS_READ_LIMIT = 200;
export const EXTRAS_PER_ADDRESS = 5;

const toPayment = (p: Record<string, unknown>): PaymentRecord => ({
  tx_hash: String(p.tx_hash),
  to_address: String(p.to_address),
  amount_units: p.amount_units as string | number,
  block_time: String(p.block_time),
  kind: p.kind === "extra" ? "extra" : "paid",
});

/** Stored payments: counted ones (oldest first, up to 5000), then the newest extras (at most 5 per person).
 * Two queries, so extras can never push counted payments out of the read. Before sql/005 there is no
 * `kind` column: every row is counted and there are no extras. */
export async function readPayments(db: SupabaseClient, to?: string): Promise<PaymentRecord[]> {
  const base = () => {
    const q = db.from("pledger_payments").select("*");
    return to ? q.eq("to_address", to) : q;
  };
  // Supabase returns 1000 rows by default; ask for up to 5000.
  let paid = await base().eq("kind", "paid").order("block_time", { ascending: true }).range(0, 4999);
  const before005 = isMissingSchema(paid.error);
  if (before005) paid = await base().order("block_time", { ascending: true }).range(0, 4999);
  if (paid.error) throw new Error("db-read-failed");
  const counted = ((paid.data ?? []) as Record<string, unknown>[]).map(toPayment);
  if (before005) return counted;

  const ex = await base().eq("kind", "extra").order("block_time", { ascending: false }).limit(EXTRAS_READ_LIMIT);
  if (ex.error) {
    if (isMissingSchema(ex.error)) return counted;
    throw new Error("db-read-failed");
  }
  const perAddress = new Map<string, number>();
  const extras = ((ex.data ?? []) as Record<string, unknown>[]).map(toPayment).filter((p) => {
    const a = p.to_address.toLowerCase();
    const n = perAddress.get(a) ?? 0;
    perAddress.set(a, n + 1);
    return n < EXTRAS_PER_ADDRESS;
  });
  return [...counted, ...extras];
}

export async function readClaims(db: SupabaseClient): Promise<ClaimRecord[]> {
  const r = await db.from("pledger_claims").select(CLAIM_COLUMNS).order("created_at", { ascending: true }).range(0, 4999);
  if (r.error) throw new Error("db-read-failed");
  return (r.data ?? []) as unknown as ClaimRecord[];
}

/** A line entry with the person's full payout address and all their claim fees in claim-time order
 * (the order payments fill them). Server only: never send these to a browser. */
export type ServerLineEntry = LineEntry & { address: string; personFees: number[] };

type RecordRows = { states: Map<string, string>; uids: Map<string, { uid: string; at: string }> };

/** record_state per claim and the latest recorded attestation uid per claim. Best effort: on any read error
 * that part is empty, and the line shows no record state. */
async function readRecords(db: SupabaseClient): Promise<RecordRows> {
  const out: RecordRows = { states: new Map(), uids: new Map() };
  const [st, at] = await Promise.all([
    Promise.resolve(db.from("pledger_claims").select("id,record_state").range(0, 4999)).catch(() => null),
    Promise.resolve(
      db.from("pledger_attestations").select("claim_id,uid,created_at").eq("state", "recorded").order("created_at", { ascending: false }).range(0, 4999),
    ).catch(() => null),
  ]);
  if (st && !st.error) for (const r of (st.data ?? []) as { id: string; record_state?: string | null }[]) if (r.record_state) out.states.set(r.id, r.record_state);
  if (at && !at.error) {
    for (const r of (at.data ?? []) as { claim_id: string; uid?: string | null; created_at?: string }[]) {
      if (!r.uid) continue;
      const cur = out.uids.get(r.claim_id);
      const when = String(r.created_at ?? "");
      if (!cur || when > cur.at) out.uids.set(r.claim_id, { uid: r.uid, at: when });
    }
  }
  return out;
}

/** Add `recordState` and `recordUid` to each entry from its claims (same person and group).
 * recordState: "pending" if any claim is pending, "recorded" if all are recorded, else null.
 * recordUid: the latest recorded attestation across those claims, or null. */
export function withRecords<T extends LineEntry>(line: T[], claims: ClaimRecord[], rec: RecordRows): T[] {
  const addressOf = new Map(claims.map((c) => [c.id, c.payout_address.toLowerCase()]));
  const claimsOf = new Map<string, ClaimRecord[]>();
  for (const c of claims) {
    const k = `${c.payout_address.toLowerCase()}|${c.self_backed ? 1 : 2}`;
    claimsOf.set(k, [...(claimsOf.get(k) ?? []), c]);
  }
  return line.map((e) => {
    const mine = claimsOf.get(`${addressOf.get(e.pid) ?? ""}|${e.group}`) ?? [];
    const states = mine.map((c) => rec.states.get(c.id));
    const recordState = states.some((s) => s === "pending") ? "pending" : states.length && states.every((s) => s === "recorded") ? "recorded" : null;
    let latest: { uid: string; at: string } | undefined;
    for (const c of mine) {
      const u = rec.uids.get(c.id);
      if (u && (!latest || u.at > latest.at)) latest = u;
    }
    return { ...e, recordState, recordUid: latest?.uid ?? null };
  });
}

/** The line plus the raw payments it was built from (the home tracker sums them; extras included, marked).
 * Entries carry the full `address` for server-side sums (computeTotals); loadLine strips it. */
export async function loadLineData(db: SupabaseClient): Promise<{ line: ServerLineEntry[]; payments: PaymentRecord[] }> {
  const [claims, pays, rec] = await Promise.all([readClaims(db), readPayments(db), readRecords(db)]);
  const addressOf = new Map(claims.map((c) => [c.id, c.payout_address.toLowerCase()]));
  const feesOf = new Map<string, number[]>();
  for (const c of byClaimTime(claims)) {
    const a = c.payout_address.toLowerCase();
    feesOf.set(a, [...(feesOf.get(a) ?? []), c.fee_cents]);
  }
  const line = withRecords(buildLine(claims, pays), claims, rec).map((e) => {
    const address = addressOf.get(e.pid) ?? "";
    return { ...e, address, personFees: feesOf.get(address) ?? [] };
  });
  return { line, payments: pays };
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
  const [claims, pays, holds, rec] = await Promise.all([readClaims(db), readPayments(db), activeHolds(db, now), readRecords(db)]);
  const addressOf = new Map(claims.map((c) => [c.id, c.payout_address.toLowerCase()]));
  return markHeld(withRecords(buildLine(claims, pays), claims, rec), addressOf, holds);
}

export type HoldResult =
  | { ok: true; until: string; ids: Map<string, string>; skipped: string[] }
  | { ok: false; missing: true }
  | { ok: false; missing?: false; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;
/** A hold that ran out with no payment cannot be taken again for this long, so one payer cannot keep a
 * person out of "Help pay people back" by holding them over and over. */
export const HOLD_COOLDOWN_MS = 20 * 60 * 1000;

const toTime = (iso: unknown) => Date.parse(String(iso ?? "").replace(/(\.\d{3})\d+/, "$1"));

/** Addresses in cooldown: their latest hold lapsed within HOLD_COOLDOWN_MS and no counted payment to them was
 * recorded since that hold was made. Best effort: on any read error nobody is in cooldown. */
export async function holdCooldowns(db: SupabaseClient, addresses: string[], now = Date.now()): Promise<Set<string>> {
  const out = new Set<string>();
  if (!addresses.length) return out;
  try {
    const h = await db
      .from("pledger_holds")
      .select("payout_address,created_at,expires_at")
      .in("payout_address", addresses)
      .gt("expires_at", new Date(now - HOLD_COOLDOWN_MS).toISOString())
      .limit(500);
    if (h.error) return out;
    const latest = new Map<string, { created: number; expires: number }>();
    for (const r of (h.data ?? []) as { payout_address: string; created_at?: string; expires_at: string }[]) {
      const a = String(r.payout_address).toLowerCase();
      const expires = toTime(r.expires_at);
      if (!Number.isFinite(expires)) continue;
      const created = Number.isFinite(toTime(r.created_at)) ? toTime(r.created_at) : expires - HOLD_MS;
      const cur = latest.get(a);
      if (!cur || expires > cur.expires) latest.set(a, { created, expires });
    }
    // Lapsed = ran its full time. A hold ended early (endHolds: one IP held too many) is not a payer's lapse.
    const lapsed = [...latest].filter(([, x]) => x.expires <= now && now - x.expires < HOLD_COOLDOWN_MS && x.expires - x.created >= HOLD_MS - 1000);
    if (!lapsed.length) return out;
    const p = await db.from("pledger_payments").select("to_address,created_at,block_time,kind").in("to_address", lapsed.map(([a]) => a)).eq("kind", "paid").limit(1000);
    if (p.error) return out;
    const pays = (p.data ?? []) as { to_address: string; created_at?: string; block_time?: string }[];
    for (const [a, x] of lapsed) {
      const paidSince = pays.some((r) => String(r.to_address).toLowerCase() === a && toTime(r.created_at ?? r.block_time) >= x.created);
      if (!paidSince) out.add(a);
    }
  } catch {
    // Holds are a courtesy; never block on a failed read.
  }
  return out;
}

/** Hold these payout addresses for HOLD_MS. A new row per call; the latest expiry wins, so this also refreshes.
 * `ids` maps each held address to its new row id, so the caller can end exactly these holds later.
 * Addresses in cooldown (holdCooldowns) are not held and come back in `skipped`.
 * Rows that ended over a day ago are cleared first (best effort). */
export async function createHolds(db: SupabaseClient, addresses: string[], source: HoldSource, now = Date.now()): Promise<HoldResult> {
  const until = new Date(now + HOLD_MS).toISOString();
  const wanted = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (!wanted.length) return { ok: false, error: "Unknown person" };
  const cooling = await holdCooldowns(db, wanted, now);
  const skipped = wanted.filter((a) => cooling.has(a));
  const rows = wanted.filter((a) => !cooling.has(a)).map((payout_address) => ({ id: randomUUID(), payout_address, created_at: new Date(now).toISOString(), expires_at: until, source }));
  if (!rows.length) return { ok: true, until, ids: new Map(), skipped };
  try {
    await db.from("pledger_holds").delete().lt("expires_at", new Date(now - DAY_MS).toISOString());
  } catch {
    // Cleanup only; a failure here never blocks a hold.
  }
  const r = await db.from("pledger_holds").insert(rows);
  if (r.error) return isMissingSchema(r.error) ? { ok: false, missing: true } : { ok: false, error: "Could not hold" };
  return { ok: true, until, ids: new Map(rows.map((x) => [x.payout_address, x.id])), skipped };
}

/** End these hold rows now (best effort): used when one IP holds more people than it may. */
export async function endHolds(db: SupabaseClient, ids: string[], now = Date.now()): Promise<void> {
  if (!ids.length) return;
  try {
    const r = await db.from("pledger_holds").update({ expires_at: new Date(now).toISOString() }).in("id", ids);
    if (r.error && !isMissingSchema(r.error)) console.warn("[pledger] hold end failed", { code: r.error.code });
  } catch {
    // Holds are a courtesy; nothing to do.
  }
}

/** The public line (no full addresses). */
export async function loadLine(db: SupabaseClient): Promise<LineEntry[]> {
  return (await loadLineData(db)).line.map(({ address: _a, personFees: _f, ...e }) => e);
}

/** Full payout address for one person (pid = their earliest claim id). Server only. */
export async function payoutAddressFor(db: SupabaseClient, pid: string): Promise<{ address: string } | { error: string; status: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(pid)) return { error: "Unknown person", status: 400 };
  const { data, error } = await db.from("pledger_claims").select("payout_address").eq("id", pid).limit(1).maybeSingle();
  if (error) return { error: "Could not load", status: 500 };
  if (!data) return { error: "Unknown person", status: 404 };
  return { address: String(data.payout_address).toLowerCase() };
}

/** Full payout addresses for many people at once (pid -> address). Server only. */
export async function payoutAddressesFor(db: SupabaseClient, pids: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(pids)].filter((p) => /^[0-9a-f-]{36}$/i.test(p));
  if (!ids.length) return new Map();
  // Bounded like the line read: never more rows than ids asked for, and never past 5000.
  const { data, error } = await db.from("pledger_claims").select("id,payout_address").in("id", ids.slice(0, 5000)).limit(Math.min(ids.length, 5000));
  if (error) throw new Error("db-read-failed");
  return new Map((data ?? []).map((r: { id: string; payout_address: string }) => [r.id, String(r.payout_address).toLowerCase()]));
}
