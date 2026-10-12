// Artizen give-back: pure claim logic shared by API routes, pages and tests.
// No node: imports here; this file is safe to import from client components.

export type DisplayMode = "full" | "initials" | "project";
export type RowKind = "receipt" | "sold" | "other";

/** TODO(copy): Erin sets the real next update date. */
export const NEXT_UPDATE = "20 October 2026";

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
};

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
};

// ---------- reasons ----------

const SIGNATURE_REASONS = /^(dkim-|no-artizen-signature|unsigned-header|bad-from|from-not-artizen|duplicate-header)/;

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

export function isDisplayMode(v: unknown): v is DisplayMode {
  return v === "full" || v === "initials" || v === "project";
}

// ---------- signed message ----------

export type ClaimPayload = {
  fingerprints: string[];
  payout: string;
  display: { mode: DisplayMode; name: string };
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

/**
 * Build the public line.
 * Per person (payout address): group 1 = self-backed fee total, group 2 = other fees.
 * Group 1 entries come first, each group ascending by total; ties go to the earlier first claim.
 * A person can appear in both groups. Payments to an address fill that person's entries in line order.
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

  const paidLeft = new Map<string, number>();
  for (const pay of payments) {
    const a = pay.to_address.toLowerCase();
    paidLeft.set(a, (paidLeft.get(a) ?? 0) + unitsToCents(BigInt(String(pay.amount_units).split(".")[0] || "0")));
  }

  return sorted.map((a, i) => {
    const left = paidLeft.get(a.address) ?? 0;
    const paidCents = Math.min(left, a.feeCents);
    paidLeft.set(a.address, left - paidCents);
    const status: LineStatus = paidCents >= a.feeCents && a.feeCents > 0 ? "paid" : paidCents > 0 ? "partial" : "waiting";
    const projects = [...a.projects].sort();
    const label = latestLabel.get(a.address)?.label || projects.join(", ");
    return {
      pid: pidOf.get(a.address)!.id,
      place: i + 1,
      group: a.group,
      label,
      projects,
      feeCents: a.feeCents,
      paidCents,
      status,
      shortAddress: shortAddress(a.address),
      firstAt: a.firstAt,
    };
  });
}

export function statusText(e: Pick<LineEntry, "status" | "paidCents" | "feeCents">): string {
  if (e.status === "paid") return "Paid";
  if (e.status === "partial") return `Paid ${formatCents(e.paidCents)} of ${formatCents(e.feeCents)}`;
  return "Waiting";
}
