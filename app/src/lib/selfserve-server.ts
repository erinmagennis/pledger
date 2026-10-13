// Server side of self-serve testnet pledges: caps, storage in pledger_selfserve_pledges (sql/008),
// and the create flow. The chain step is passed in, so tests run without Tempo.
import "server-only";
import { createHash, createHmac } from "node:crypto";
import { getAddress, type Address } from "viem";
import { isMissingSchema } from "./claims-server";
import { getSupabase } from "./supabase";
import type { Deployed } from "./selfserve-chain";
import {
  DEMO_RECIPIENT,
  GLOBAL_PER_DAY,
  PER_IP_PER_DAY,
  SLUG_RE,
  capCheck,
  fromRow,
  toRow,
  validatePledgeInput,
  type Invalid,
  type PledgeInput,
  type PoolConfig,
  type SelfServeRow,
} from "./selfserve";

export const TABLE = "pledger_selfserve_pledges";
const DAY = 24 * 60 * 60 * 1000;

/** Same scheme as the demo faucet log: HMAC with PLEDGER_PEPPER, plain sha256 without it. Never the raw IP. */
export function hashIp(ip: string): string {
  const pepper = process.env.PLEDGER_PEPPER;
  return pepper ? createHmac("sha256", pepper).update(ip).digest("hex") : createHash("sha256").update(ip).digest("hex");
}

export type CreateResult =
  | { status: 200; body: { ok: true; slug: string; address: string; url: string; deployTx: string; depositTx: string } }
  | { status: 400; body: { ok: false; error: string; errors: Invalid["errors"] } }
  | { status: 429 | 502 | 503; body: { ok: false; error: string } };

type Deploy = (input: PledgeInput, recipient: Address) => Promise<Deployed>;

/** The whole create flow. `deploy` does the chain work (selfserve-chain.deployAndFund in the route). */
export async function createPledge(raw: unknown, ip: string, deploy: Deploy, nowMs = Date.now()): Promise<CreateResult> {
  const v = validatePledgeInput(raw, Math.floor(nowMs / 1000));
  if (!v.ok) {
    const first = Object.values(v.errors)[0] ?? "Check the form.";
    return { status: 400, body: { ok: false, error: first, errors: v.errors } };
  }

  // Storage is required: a pledge page is found by its row. Before sql/008 runs, say so plainly.
  const db = getSupabase();
  if (!db) return { status: 503, body: { ok: false, error: "Making test pledges is not switched on yet (no database connected)." } };

  const ipHash = hashIp(ip);
  const since = new Date(nowMs - DAY).toISOString();
  const [mine, all] = await Promise.all([
    db.from(TABLE).select("slug").eq("ip_hash", ipHash).gt("created_at", since).limit(PER_IP_PER_DAY),
    db.from(TABLE).select("slug").gt("created_at", since).limit(GLOBAL_PER_DAY),
  ]);
  const err = mine.error ?? all.error;
  if (err) {
    if (isMissingSchema(err)) return { status: 503, body: { ok: false, error: "Making test pledges is not switched on yet. The database table is coming." } };
    console.warn("[pledger] selfserve cap read failed", { code: err.code });
    return { status: 503, body: { ok: false, error: "Could not check today's limits just now. Try again in a minute." } };
  }
  const cap = capCheck((mine.data ?? []).length, (all.data ?? []).length);
  if (!cap.ok) return { status: 429, body: { ok: false, error: cap.error } };

  const recipient = getAddress(v.value.recipient ?? DEMO_RECIPIENT);
  let d: Deployed;
  try {
    d = await deploy(v.value, recipient);
  } catch (e) {
    const msg = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message).split("\n")[0] : "unknown error";
    console.warn("[pledger] selfserve deploy failed", { msg });
    return { status: 502, body: { ok: false, error: `The pledge could not be set up on Tempo testnet. ${msg}` } };
  }

  const row = toRow(v.value, { ...d, recipient: d.recipient }, ipHash);
  const ins = await db.from(TABLE).insert(row);
  if (ins.error) {
    // The pool exists on chain but has no page. Log what is needed to add the row by hand.
    console.warn("[pledger] selfserve row write failed", { code: ins.error.code, pool: d.address, slug: row.slug });
    return { status: 502, body: { ok: false, error: `The pool was made on Tempo (${d.address}) but its page could not be saved. Send us that address.` } };
  }
  return {
    status: 200,
    body: { ok: true, slug: row.slug, address: d.address, url: `/pledges/p/${row.slug}`, deployTx: d.deployTx, depositTx: d.depositTx },
  };
}

/** A created pledge by slug, or null when it does not exist (or the table is not there yet). */
export async function getSelfServe(slug: string): Promise<PoolConfig | null> {
  if (!SLUG_RE.test(slug)) return null;
  const db = getSupabase();
  if (!db) return null;
  const r = await db.from(TABLE).select("*").eq("slug", slug).maybeSingle();
  if (r.error) {
    if (!isMissingSchema(r.error)) console.warn("[pledger] selfserve read failed", { code: r.error.code });
    return null;
  }
  return r.data ? fromRow(r.data as SelfServeRow) : null;
}
