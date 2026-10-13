// Self-serve pledges on Tempo testnet: input rules, caps, slugs and row mapping.
// Pure: no server imports, safe for client components (the /make form) and tests.

export const MAX_POOL_USD = 500;
export const MIN_POOL_USD = 1;
export const MAX_CAP_USD = 500;
export const MAX_LOCK_DAYS = 365;
export const MIN_LOCK_HOURS = 1;
export const MAX_NAME = 60;
/** Ratios offered in the form: dollars of match per $1 given. */
export const RATIOS = ["1:2", "1:1", "2:1", "3:1"] as const;
export type Ratio = (typeof RATIOS)[number];

/** Caps on creating pledges. Per visitor counts by IP hash; both are per rolling 24 hours. */
export const PER_IP_PER_DAY = 3;
export const GLOBAL_PER_DAY = 40;

/** The demo recipient: a test project address that exists only on Tempo testnet. */
export const DEMO_RECIPIENT = "0x420ff9871fa9Dc61232356F2c37c7C5E42EC0967";

export type PledgeInput = {
  name: string;
  poolUsd: number;
  ratio: Ratio;
  capUsd: number;
  /** unix seconds */
  lockUntil: number;
  /** null = the demo project */
  recipient: string | null;
};

export type Valid = { ok: true; value: PledgeInput };
export type Invalid = { ok: false; errors: Partial<Record<keyof PledgeInput | "form", string>> };

const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** "2:1" to 20000 basis points (10000 = 1:1). */
export function ratioToBps(r: Ratio): number {
  const [m, g] = r.split(":").map(Number);
  return Math.round((m / g) * 10_000);
}

/** 20000 to "2:1", 5000 to "1:2". */
export function bpsToRatio(bps: number): string {
  if (bps >= 10_000) {
    const x = bps / 10_000;
    return `${Number.isInteger(x) ? x : x.toFixed(2)}:1`;
  }
  const x = 10_000 / bps;
  return `1:${Number.isInteger(x) ? x : x.toFixed(2)}`;
}

/** Whole dollars or cents only; returns NaN for anything else. */
function money(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim().replace(/^\$/, "")) : NaN;
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) === n * 100 ? n : NaN;
}

/** Accepts unix seconds or a "YYYY-MM-DD" date (taken as the end of that day, UTC). */
function lockOf(v: unknown): number {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const t = Date.parse(v + "T23:59:59Z");
    return Number.isFinite(t) ? Math.floor(t / 1000) : NaN;
  }
  return NaN;
}

/** Checks a raw form body. Messages are written for the person filling the form. */
export function validatePledgeInput(raw: unknown, nowSec = Math.floor(Date.now() / 1000)): Valid | Invalid {
  const b = (raw ?? {}) as Record<string, unknown>;
  const errors: Invalid["errors"] = {};

  const name = typeof b.name === "string" ? b.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 3) errors.name = "Give the pledge a name of at least 3 characters.";
  else if (name.length > MAX_NAME) errors.name = `Keep the name to ${MAX_NAME} characters or fewer.`;
  else if (/[<>]/.test(name)) errors.name = "The name cannot use < or >.";

  const poolUsd = money(b.poolUsd);
  if (Number.isNaN(poolUsd) || poolUsd < MIN_POOL_USD || poolUsd > MAX_POOL_USD) {
    errors.poolUsd = `Choose a match pool from $${MIN_POOL_USD} to $${MAX_POOL_USD}.`;
  }

  const ratio = RATIOS.includes(b.ratio as Ratio) ? (b.ratio as Ratio) : null;
  if (!ratio) errors.ratio = "Choose a match ratio.";

  const capUsd = money(b.capUsd);
  if (Number.isNaN(capUsd) || capUsd < 1 || capUsd > MAX_CAP_USD) errors.capUsd = `Choose a cap per donor from $1 to $${MAX_CAP_USD}.`;
  else if (!errors.poolUsd && capUsd > poolUsd) errors.capUsd = "The cap per donor cannot be more than the whole pool.";

  const lockUntil = lockOf(b.lockUntil);
  if (Number.isNaN(lockUntil)) errors.lockUntil = "Choose a date.";
  else if (lockUntil < nowSec + MIN_LOCK_HOURS * 3600) errors.lockUntil = "Choose a date in the future.";
  else if (lockUntil > nowSec + MAX_LOCK_DAYS * 86400) errors.lockUntil = "Choose a date within one year.";

  let recipient: string | null = null;
  if (typeof b.recipient === "string" && b.recipient.trim() !== "") {
    const r = b.recipient.trim();
    if (!ADDR.test(r)) errors.recipient = "That is not a valid 0x address. It should be 0x and 40 letters or numbers.";
    else if (/^0x0{40}$/.test(r)) errors.recipient = "That address cannot receive money.";
    else recipient = r;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, poolUsd, ratio: ratio!, capUsd, lockUntil, recipient } };
}

/** Units of a 6-decimal token for a dollar amount with at most 2 decimals. */
export function toUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 100)) * 10_000n;
}

/** Decide whether a create may go ahead, from counts of the last 24 hours. */
export function capCheck(ipCount: number, globalCount: number): { ok: true } | { ok: false; error: string } {
  if (ipCount >= PER_IP_PER_DAY) {
    return { ok: false, error: `You can make ${PER_IP_PER_DAY} test pledges a day. Try again tomorrow.` };
  }
  if (globalCount >= GLOBAL_PER_DAY) {
    return { ok: false, error: "Test pledges are full for today. Try again tomorrow." };
  }
  return { ok: true };
}

/** "Riverside Tool Library match!" + pool address to "riverside-tool-library-match-3f9a2c". */
export function makeSlug(name: string, address: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const tail = address.toLowerCase().replace(/^0x/, "").slice(0, 6);
  return `${base || "pledge"}-${tail}`;
}

export const SLUG_RE = /^[a-z0-9-]{3,60}$/;

/** A created pledge as stored in pledger_selfserve_pledges. */
export type SelfServeRow = {
  slug: string;
  pool_address: string;
  name: string;
  pool_usd: number;
  match_bps: number;
  cap_usd: number;
  lock_until: string;
  recipient: string;
  recipient_is_demo: boolean;
  sponsor: string;
  deploy_tx: string;
  deposit_tx: string;
  deploy_block: number;
  ip_hash: string;
  created_at?: string;
};

/** The facts a pool page needs, from a row (or from the demo constants). Safe for the browser: no ip_hash. */
export type PoolConfig = {
  slug: string;
  address: string;
  name: string;
  poolUsd: number;
  matchBps: number;
  capUsd: number;
  /** unix seconds */
  lockUntil: number;
  recipient: string;
  recipientLabel: string;
  recipientIsDemo: boolean;
  sponsor: string;
  deployTx: string;
  deployBlock: number;
};

export function toRow(
  input: PledgeInput,
  chain: { address: string; sponsor: string; deployTx: string; depositTx: string; deployBlock: number; recipient: string },
  ipHash: string,
): SelfServeRow {
  return {
    slug: makeSlug(input.name, chain.address),
    pool_address: chain.address.toLowerCase(),
    name: input.name,
    pool_usd: input.poolUsd,
    match_bps: ratioToBps(input.ratio),
    cap_usd: input.capUsd,
    lock_until: new Date(input.lockUntil * 1000).toISOString(),
    recipient: chain.recipient,
    recipient_is_demo: input.recipient === null,
    sponsor: chain.sponsor,
    deploy_tx: chain.deployTx,
    deposit_tx: chain.depositTx,
    deploy_block: chain.deployBlock,
    ip_hash: ipHash,
  };
}

export function fromRow(r: SelfServeRow): PoolConfig {
  return {
    slug: r.slug,
    address: r.pool_address,
    name: r.name,
    poolUsd: Number(r.pool_usd),
    matchBps: Number(r.match_bps),
    capUsd: Number(r.cap_usd),
    lockUntil: Math.floor(Date.parse(r.lock_until) / 1000),
    recipient: r.recipient,
    recipientLabel: r.recipient_is_demo ? "Test project" : "Recipient",
    recipientIsDemo: r.recipient_is_demo,
    sponsor: r.sponsor,
    deployTx: r.deploy_tx,
    deployBlock: Number(r.deploy_block),
  };
}

/** "$5", "$12.50". */
export function dollars(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}

/** "1:1, up to $20 per donor". */
export function ruleLine(c: Pick<PoolConfig, "matchBps" | "capUsd">): string {
  return `${bpsToRatio(c.matchBps)} match, up to ${dollars(c.capUsd)} per donor`;
}

/** Match for a gift of `giftUsd`, before the pool or cap run out. */
export function matchFor(giftUsd: number, matchBps: number): number {
  return Math.floor(giftUsd * matchBps) / 10_000;
}
