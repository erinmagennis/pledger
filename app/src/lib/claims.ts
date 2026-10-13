// Artizen give-back: pure claim logic shared by API routes, pages and tests.
// No node: imports here; this file is safe to import from client components.

export type DisplayMode = "full" | "initials" | "project";
export type RowKind = "receipt" | "sold" | "other";

/** Max age of a signed claim message, both directions. */
export const SIGNATURE_MAX_AGE_MS = 10 * 60 * 1000;
export const MAX_FILES = 50;

/** One verified email, as shown to the claimant. Never contains the email address. */
export type ReviewRow = {
  file: string;
  kind: RowKind;
  ok: boolean;
  reason?: string;
  message?: string;
  showHelp?: boolean;
  fingerprint?: string;
  date?: string;
  project?: string;
  feeCents?: number;
  selfBacked?: boolean;
};

export type ReviewSummary = {
  selfBackedCents: number;
  otherCents: number;
  totalCents: number;
  claimable: number;
};

/** Stored claim, as read back from pledger_claims (to_hash omitted on purpose). */
export type ClaimRecord = {
  id: string;
  fingerprint: string;
  project: string;
  purchased_at: string;
  fee_cents: number;
  self_backed: boolean;
  payout_address: string;
  display_mode: DisplayMode;
  display_name: string | null;
  created_at: string;
};

export type PaymentRecord = {
  tx_hash: string;
  to_address: string;
  amount_units: string | number;
  block_time: string;
  /** 'extra' (sql/005): real money that did not match what was owed. Shown, never counted. Missing means 'paid'. */
  kind?: "paid" | "extra";
};

/** True for a payment stored as an extra: it never counts toward paid, owed, totals or records. */
export const isExtra = (p: Pick<PaymentRecord, "kind">) => p.kind === "extra";

/** A payment that arrived but did not match what was owed, shown on the person's row. */
export type LineExtra = { cents: number; txHash: string };

export type LineStatus = "waiting" | "partial" | "paid";

export type LineEntry = {
  /** Opaque id for the person (their earliest claim id). Used to look up the payout address on demand. */
  pid: string;
  place: number;
  group: 1 | 2;
  label: string;
  projects: string[];
  feeCents: number;
  paidCents: number;
  status: LineStatus;
  shortAddress: string;
  firstAt: string;
  /** Someone is paying this person right now (sql/005 holds), so Help pay skips them until heldUntil. */
  held?: boolean;
  heldUntil?: string;
  /** Extras sent to this person, on their first place only. */
  extras?: LineExtra[];
  /** Shortfall forgiven by the payment rule (within 0.9%, at most $1.00, counts as paid), in cents; 0 when none. */
  forgivenCents?: number;
  /** Latest recorded public record (EAS uid) across this entry's claims, or null. */
  recordUid?: string | null;
  /** From pledger_claims.record_state: "pending" if any claim waits for its record, "recorded" if all have one. */
  recordState?: "pending" | "recorded" | null;
};

// ---------- reasons ----------

const SIGNATURE_REASONS = /^(dkim-|no-artizen-signature|unsigned-header|bad-from|from-not-artizen|duplicate-header)/;

export const NO_FEE = "This receipt has no endowment fee";

/** Map verifier reasons to short, plain messages. */
export function friendlyReason(reason?: string): { message: string; showHelp?: boolean } {
  if (!reason) return { message: "" };
  if (SIGNATURE_REASONS.test(reason)) return { message: "Download the original email from your inbox", showHelp: true };
  switch (reason) {
    case "outside-season":
      return { message: "Season 7 only for now" };
    case "duplicate":
      return { message: "Already claimed" };
    case "duplicate-upload":
      return { message: "Same email added twice" };
    case "excluded":
      return { message: "This receipt belongs to the pledge owner" };
    case "not-a-receipt":
      return { message: "Not an Artizen receipt" };
    case "no-fee":
      return { message: NO_FEE };
    case "too-large":
    case "not-rfc822":
    case "not-a-buffer":
      return { message: "This is not an email file (.eml)" };
    case "no-message-id":
    case "no-to":
    case "bad-to":
      return { message: "Download the original email from your inbox", showHelp: true };
    default:
      return { message: "We could not read this email" };
  }
}

// ---------- money ----------

export const toCents = (usd: number) => Math.round(usd * 100);
export const centsToUnits = (cents: number) => BigInt(cents) * 10_000n; // USDC has 6 decimals
export const unitsToCents = (units: bigint) => Number(units / 10_000n);

export function formatCents(cents: number): string {
  const whole = cents % 100 === 0;
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/** "$12.50" with cents always shown: for amounts someone must send exactly. */
export function formatCentsExact(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function summarize(rows: ReviewRow[]): ReviewSummary {
  let selfBackedCents = 0;
  let otherCents = 0;
  let claimable = 0;
  for (const r of rows) {
    if (!r.ok || r.kind !== "receipt" || r.feeCents === undefined) continue;
    claimable++;
    if (r.selfBacked) selfBackedCents += r.feeCents;
    else otherCents += r.feeCents;
  }
  return { selfBackedCents, otherCents, totalCents: selfBackedCents + otherCents, claimable };
}

// ---------- duplicates ----------

/**
 * Mark rows that cannot be claimed: fingerprint already stored, repeated in this upload,
 * or a receipt sent to an excluded inbox. Pure: callers pass the sets.
 */
export function markUnclaimable<T extends { ok: boolean; kind?: string; reason?: string; fingerprint?: string; toHash?: string }>(
  rows: T[],
  existing: Set<string>,
  excludedHashes: Set<string>,
): T[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    if (!r.fingerprint) return r;
    if (seen.has(r.fingerprint)) return { ...r, ok: false, reason: "duplicate-upload" };
    seen.add(r.fingerprint);
    if (!r.ok) return r;
    if (existing.has(r.fingerprint)) return { ...r, ok: false, reason: "duplicate" };
    if (r.kind === "receipt" && r.toHash && excludedHashes.has(r.toHash)) return { ...r, ok: false, reason: "excluded" };
    return r;
  });
}

export function parseExcludedHashes(env?: string): Set<string> {
  return new Set(
    (env ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[0-9a-f]{64}$/.test(s)),
  );
}

// ---------- display ----------

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase() + ".")
    .join(" ");
}

/** Public label stored with the claim. Returns null for project-only. Throws on a missing name. */
export function displayLabel(mode: DisplayMode, name: string): string | null {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
  if (mode === "project") return null;
  if (!clean) throw new Error("name-required");
  return mode === "full" ? clean : initialsOf(clean);
}

/** A hostname-like token: letters, digits or hyphens, a dot with no space either side, then 2 to 4 letters ending the token.
 * "pledger.com" fails; "O. Neal" and "St. Ann" pass because a space follows the dot. */
const HOSTNAME = /(?:^|\s)[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,4}(?=\s|$)/u;

/**
 * Why a public name cannot be used, or null when it is fine. Letters (any script), digits, spaces
 * and . ' - only, up to 60 characters, and nothing that looks like a wallet, link or email.
 */
export function nameProblem(name: string): string | null {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length > 60) return "Keep the name to 60 characters or fewer";
  if (!/^[\p{L}\p{M}\p{N} .'’-]*$/u.test(clean)) return "Use only letters, numbers, spaces and . ' -";
  if (/\b0x|http|www|@/i.test(clean) || HOSTNAME.test(clean)) return "A name cannot include a link, email or wallet address";
  return null;
}

export function isDisplayMode(v: unknown): v is DisplayMode {
  return v === "full" || v === "initials" || v === "project";
}

// ---------- signed message ----------

export type ClaimPayload = {
  fingerprints: string[];
  payout: string;
  display: { mode: DisplayMode; name: string };
  /** The claimant confirms they have not reversed or charged back the payment. Must be true. */
  noChargeback: true;
  notRestrictedRegion: true;
  timestamp: number;
};

/** JSON with keys sorted at every level, no whitespace. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

export function normalizePayload(p: ClaimPayload): ClaimPayload {
  return {
    fingerprints: [...new Set(p.fingerprints.map((f) => f.toLowerCase()))].sort(),
    payout: p.payout.toLowerCase(),
    display: { mode: p.display.mode, name: p.display.mode === "project" ? "" : p.display.name.replace(/\s+/g, " ").trim() },
    noChargeback: p.noChargeback,
    notRestrictedRegion: p.notRestrictedRegion,
    timestamp: Math.floor(p.timestamp),
  };
}

export function claimMessage(p: ClaimPayload): string {
  return "Pledger claim: Artizen give-back\n" + canonicalJson(normalizePayload(p));
}

export type SignatureVerifier = (args: { address: `0x${string}`; message: string; signature: `0x${string}` }) => Promise<boolean>;

/**
 * Check a signed claim against the fingerprints the server re-verified itself.
 * The signer must be the payout address.
 */
export async function checkClaimSignature(args: {
  payload: ClaimPayload;
  signature: string;
  address: string;
  verifiedFingerprints: string[];
  now: number;
  verify: SignatureVerifier;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const p = normalizePayload(args.payload);
  const addr = args.address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return { ok: false, reason: "bad-address" };
  if (p.payout !== addr) return { ok: false, reason: "payout-mismatch" };
  if (p.noChargeback !== true) return { ok: false, reason: "no-chargeback" };
  if (p.notRestrictedRegion !== true) return { ok: false, reason: "restricted-region" };
  if (!/^0x[0-9a-fA-F]+$/.test(args.signature)) return { ok: false, reason: "bad-signature" };
  if (Math.abs(args.now - p.timestamp) > SIGNATURE_MAX_AGE_MS) return { ok: false, reason: "signature-expired" };
  const want = [...new Set(args.verifiedFingerprints.map((f) => f.toLowerCase()))].sort();
  if (want.length === 0) return { ok: false, reason: "nothing-to-claim" };
  if (want.length !== p.fingerprints.length || want.some((f, i) => f !== p.fingerprints[i])) {
    return { ok: false, reason: "fingerprints-mismatch" };
  }
  let valid = false;
  try {
    valid = await args.verify({ address: addr as `0x${string}`, message: claimMessage(p), signature: args.signature as `0x${string}` });
  } catch {
    valid = false;
  }
  return valid ? { ok: true } : { ok: false, reason: "bad-signature" };
}

// ---------- line ----------

export function shortAddress(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** A payment's amount_units as a bigint (Postgres numeric can come back as "123.0"). */
export const paymentUnits = (u: string | number) => BigInt(String(u).split(".")[0] || "0");

/**
 * Fill one person's claims, in claim-time order, from everything they have been paid, in USDC units.
 * The payment rule accepts a payment within 0.9% of what is owed either way, capped at $1.00 (allowanceUnits),
 * so a shortfall inside that is forgiven, never carried: when the person's total is within the allowance of all
 * their fees, every claim is paid in full; otherwise a claim within the allowance of its own fee is paid in
 * full, and the first one short of that takes all that is left.
 * `forgivenCents` is the shortfall closed on a claim paid in full (0 when none).
 */
export function fillPerson(feesCents: number[], paidUnits: bigint): { paidCents: number; status: LineStatus; forgivenCents: number }[] {
  const ok = (paid: bigint, feeCents: number) => {
    const fee = centsToUnits(feeCents);
    return feeCents > 0 && paid > 0n && paid >= fee - allowanceUnits(fee);
  };
  // Shortfall in whole cents, rounded up so the forgiven amount plus what arrived is never short of the fee.
  const short = (feeCents: number, paid: bigint) => {
    const gap = centsToUnits(feeCents) - paid;
    return gap > 0n ? Number((gap + 9_999n) / 10_000n) : 0;
  };
  const total = feesCents.reduce((s, f) => s + Math.max(0, f), 0);
  if (ok(paidUnits, total)) {
    // The whole-person shortfall lands on the last claims first (the earlier ones were paid in order).
    let gap = short(total, paidUnits);
    const out = feesCents.map((f) => (f > 0 ? { paidCents: f, status: "paid" as LineStatus, forgivenCents: 0 } : { paidCents: 0, status: "waiting" as LineStatus, forgivenCents: 0 }));
    for (let i = out.length - 1; i >= 0 && gap > 0; i--) {
      const take = Math.min(gap, Math.max(0, feesCents[i]!));
      out[i]!.forgivenCents = take;
      gap -= take;
    }
    return out;
  }
  let left = paidUnits;
  return feesCents.map((f) => {
    if (f <= 0 || left <= 0n) return { paidCents: 0, status: "waiting", forgivenCents: 0 };
    const feeUnits = centsToUnits(f);
    if (ok(left, f)) {
      const forgivenCents = short(f, left);
      left = left > feeUnits ? left - feeUnits : 0n;
      return { paidCents: f, status: "paid", forgivenCents };
    }
    const paidCents = unitsToCents(left);
    left = 0n;
    return { paidCents, status: paidCents > 0 ? "partial" : "waiting", forgivenCents: 0 };
  });
}

/** Most the payment rule allows either way: $1.00 in USDC units. */
export const MAX_ALLOWANCE_UNITS = 5_000_000n;

/** How far a payment may be from what is owed and still count as paid in full, either way:
 * 0.9% of what is owed, capped at $1.00. The payment rule (base.ts) and forgiveness here both use it. */
export function allowanceUnits(owedUnits: bigint): bigint {
  if (owedUnits <= 0n) return 0n;
  const pct = (owedUnits * 9n) / 1000n;
  return pct < MAX_ALLOWANCE_UNITS ? pct : MAX_ALLOWANCE_UNITS;
}

/** Claims oldest first (ties by id): the order payments fill them. */
export function byClaimTime<T extends { created_at: string; id: string }>(claims: T[]): T[] {
  return [...claims].sort((x, y) => (x.created_at !== y.created_at ? (x.created_at < y.created_at ? -1 : 1) : x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/**
 * Build the public line.
 * Per person (payout address): group 1 = self-backed fee total, group 2 = other fees.
 * Group 1 entries come first, each group ascending by total; ties go to the earlier first claim.
 * A person can appear in both groups. Payments to an address fill that person's claims in claim-time order.
 */
export function buildLine(claims: ClaimRecord[], payments: PaymentRecord[]): LineEntry[] {
  type Acc = { address: string; group: 1 | 2; feeCents: number; projects: Set<string>; firstAt: string; label: string; pid: string };
  const byKey = new Map<string, Acc>();
  const pidOf = new Map<string, { id: string; at: string }>();
  const latestLabel = new Map<string, { at: string; label: string }>();

  for (const c of claims) {
    const address = c.payout_address.toLowerCase();
    const p = pidOf.get(address);
    if (!p || c.created_at < p.at || (c.created_at === p.at && c.id < p.id)) pidOf.set(address, { id: c.id, at: c.created_at });
    const label = c.display_mode === "project" ? "" : c.display_name ?? "";
    const l = latestLabel.get(address);
    if (!l || c.created_at >= l.at) latestLabel.set(address, { at: c.created_at, label });

    const group: 1 | 2 = c.self_backed ? 1 : 2;
    const key = `${address}|${group}`;
    let a = byKey.get(key);
    if (!a) {
      a = { address, group, feeCents: 0, projects: new Set(), firstAt: c.created_at, label: "", pid: "" };
      byKey.set(key, a);
    }
    a.feeCents += c.fee_cents;
    a.projects.add(c.project);
    if (c.created_at < a.firstAt) a.firstAt = c.created_at;
  }

  const sorted = [...byKey.values()].sort((x, y) => {
    if (x.group !== y.group) return x.group - y.group;
    if (x.feeCents !== y.feeCents) return x.feeCents - y.feeCents;
    if (x.firstAt !== y.firstAt) return x.firstAt < y.firstAt ? -1 : 1;
    return x.address < y.address ? -1 : 1;
  });

  // Sum each person's payments in USDC units and convert to cents only per entry, so cents never get lost per payment.
  // Extras never fill an entry; they are listed on the person's first place instead.
  const paidBy = new Map<string, bigint>();
  const extrasBy = new Map<string, LineExtra[]>();
  for (const pay of payments) {
    const a = pay.to_address.toLowerCase();
    if (isExtra(pay)) {
      extrasBy.set(a, [...(extrasBy.get(a) ?? []), { cents: unitsToCents(paymentUnits(pay.amount_units)), txHash: pay.tx_hash }]);
      continue;
    }
    paidBy.set(a, (paidBy.get(a) ?? 0n) + paymentUnits(pay.amount_units));
  }

  // Fill per claim, in claim-time order, then add up per entry. A forgiven claim is closed for good:
  // a later claim never reopens its shortfall, even when it joins the same entry.
  const claimsBy = new Map<string, ClaimRecord[]>();
  for (const c of claims) {
    const a = c.payout_address.toLowerCase();
    claimsBy.set(a, [...(claimsBy.get(a) ?? []), c]);
  }
  const filled = new Map<Acc, { paidCents: number; status: LineStatus; forgivenCents: number }>();
  for (const [address, mine] of claimsBy) {
    const ordered = byClaimTime(mine);
    const fills = fillPerson(ordered.map((c) => c.fee_cents), paidBy.get(address) ?? 0n);
    const sums = new Map<1 | 2, { paid: number; n: number; paidN: number; forgiven: number }>();
    ordered.forEach((c, j) => {
      const g: 1 | 2 = c.self_backed ? 1 : 2;
      const cur = sums.get(g) ?? { paid: 0, n: 0, paidN: 0, forgiven: 0 };
      const f = fills[j]!;
      sums.set(g, { paid: cur.paid + f.paidCents, n: cur.n + (c.fee_cents > 0 ? 1 : 0), paidN: cur.paidN + (f.status === "paid" ? 1 : 0), forgiven: cur.forgiven + f.forgivenCents });
    });
    for (const g of [1, 2] as const) {
      const a = byKey.get(`${address}|${g}`);
      const t = sums.get(g);
      if (!a || !t) continue;
      const status: LineStatus = t.n > 0 && t.paidN === t.n ? "paid" : t.paid > 0 ? "partial" : "waiting";
      filled.set(a, { paidCents: t.paid, status, forgivenCents: t.forgiven });
    }
  }

  const shownExtras = new Set<string>();
  return sorted.map((a, i) => {
    const { paidCents, status, forgivenCents } = filled.get(a) ?? { paidCents: 0, status: "waiting" as LineStatus, forgivenCents: 0 };
    const projects = [...a.projects].sort();
    const label = latestLabel.get(a.address)?.label || projects.join(", ");
    const extras = shownExtras.has(a.address) ? undefined : extrasBy.get(a.address);
    shownExtras.add(a.address);
    return {
      pid: pidOf.get(a.address)!.id,
      place: i + 1,
      group: a.group,
      label,
      projects,
      feeCents: a.feeCents,
      paidCents,
      status,
      forgivenCents,
      shortAddress: shortAddress(a.address),
      firstAt: a.firstAt,
      ...(extras ? { extras } : {}),
    };
  });
}

// ---------- holds ----------

/** How long a hold keeps a person out of "Help pay people back". */
export const HOLD_MS = 10 * 60 * 1000;
export const HOLD_MINUTES = HOLD_MS / 60_000;
export type HoldSource = "pledger" | "outside";
export const isHoldSource = (v: unknown): v is HoldSource => v === "pledger" || v === "outside";

/**
 * Mark held people in the line. `addressOf` maps pid to payout address; `holds` maps address to
 * the latest expiry (ISO). A hold covers every place of that person.
 */
export function markHeld(line: LineEntry[], addressOf: Map<string, string>, holds: Map<string, string>): LineEntry[] {
  if (!holds.size) return line;
  return line.map((e) => {
    const until = holds.get(addressOf.get(e.pid) ?? "");
    return until ? { ...e, held: true, heldUntil: until } : e;
  });
}

/** Total paid back from the line, each entry capped at its fee. Home and pledge page both use this. */
export function paidFromLine(line: Pick<LineEntry, "paidCents" | "feeCents">[]): number {
  return line.reduce((s, e) => s + Math.max(0, Math.min(e.paidCents, e.feeCents)), 0);
}

export function statusText(e: Pick<LineEntry, "status" | "paidCents" | "feeCents">): string {
  if (e.status === "paid") return "Paid";
  if (e.status === "partial") return `Paid ${formatCents(e.paidCents)} of ${formatCents(e.feeCents)}`;
  return "Waiting";
}
