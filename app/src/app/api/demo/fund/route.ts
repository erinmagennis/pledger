// POST /api/demo/fund {address}
// Funds a throwaway browser wallet with Tempo testnet stablecoins via the public faucet.
// In-memory rate limit: 3 fundings per IP per hour, 1 per address. Resets on server restart,
// and each serverless instance keeps its own counts. Good enough for test money.
// Global cap (sql/006): at most GLOBAL_PER_HOUR fundings an hour across everyone, counted in
// pledger_faucet_log so it holds across instances. Before 006 runs, only the in-memory limit applies.
import { NextResponse, type NextRequest } from "next/server";
import { getAddress, isAddress, type Address } from "viem";
import { createHash, createHmac } from "node:crypto";
import { isMissingSchema } from "@/lib/claims-server";
import { getSupabase } from "@/lib/supabase";
import { TEMPO_RPC, alphaBalance, usd } from "@/lib/tempo";
import { FAUCET_DOWN_MSG, faucetDown, noteFaucet } from "@/lib/faucet-status";

export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
const PER_IP = 3;
const GLOBAL_PER_HOUR = 40;
const ipHits = new Map<string, number[]>();
const fundedAddresses = new Set<string>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** The stored stand-in for an IP. IPv4 has only about 4 billion values, so a plain sha256 can be reversed by
 * trying them all; a keyed HMAC with a server-only pepper cannot. Without PLEDGER_PEPPER set, plain sha256
 * keeps the demo working (the cap still counts) at that weaker level. */
function hashIp(ip: string): string {
  const pepper = process.env.PLEDGER_PEPPER;
  return pepper ? createHmac("sha256", pepper).update(ip).digest("hex") : createHash("sha256").update(ip).digest("hex");
}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** The faucet failed: remember it for two minutes and give the calm message. */
function faucetFail() {
  noteFaucet(false);
  return NextResponse.json({ ok: false, faucetDown: true, error: FAUCET_DOWN_MSG }, { status: 503 });
}

async function waitForBalance(addr: Address): Promise<bigint> {
  for (let i = 0; i < 12; i++) {
    const b = await alphaBalance(addr);
    if (b > 0n) return b;
    await new Promise((r) => setTimeout(r, 800));
  }
  return alphaBalance(addr);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Send JSON like {\"address\": \"0x...\"}.");
  }
  const raw = (body as { address?: unknown })?.address;
  if (typeof raw !== "string" || !isAddress(raw, { strict: false })) {
    return fail(400, "That is not a valid address.");
  }
  const address = getAddress(raw);
  const key = address.toLowerCase();

  if (fundedAddresses.has(key)) {
    // Already funded: report the balance instead of asking the faucet again.
    try {
      const balance = await alphaBalance(address);
      return NextResponse.json({ ok: true, alreadyFunded: true, address, balance: usd(balance), balanceUnits: balance.toString() });
    } catch {
      return fail(502, "This wallet already got test money, and the balance could not be read just now.");
    }
  }

  const ip = clientIp(req);
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < HOUR);
  if (hits.length >= PER_IP) {
    const waitMin = Math.ceil((HOUR - (now - hits[0])) / 60000);
    return fail(429, `Test money is limited to ${PER_IP} wallets an hour. Try again in about ${waitMin} minutes.`);
  }

  // The faucet failed in the last two minutes: do not ask it again yet.
  if (faucetDown()) return NextResponse.json({ ok: false, faucetDown: true, error: FAUCET_DOWN_MSG }, { status: 503 });

  // Global cap. A missing table (sql/006 not run) or a read error skips it: the demo keeps working.
  const db = getSupabase();
  let logging = false;
  if (db) {
    const since = new Date(now - HOUR).toISOString();
    const recent = await db.from("pledger_faucet_log").select("id").gt("created_at", since).limit(GLOBAL_PER_HOUR);
    if (!recent.error) {
      logging = true;
      if ((recent.data ?? []).length >= GLOBAL_PER_HOUR) return fail(429, "The demo is busy right now. Try again in a few minutes.");
    } else if (!isMissingSchema(recent.error)) {
      console.warn("[pledger] faucet cap read failed", { code: recent.error.code });
    }
  }

  let faucet: { result?: unknown; error?: { message?: string } };
  try {
    const res = await fetch(TEMPO_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tempo_fundAddress", params: [address] }),
      cache: "no-store",
    });
    if (!res.ok) return faucetFail();
    faucet = await res.json();
  } catch {
    return faucetFail();
  }
  if (faucet.error) return faucetFail();
  noteFaucet(true);

  hits.push(now);
  ipHits.set(ip, hits);
  fundedAddresses.add(key);
  if (db && logging) {
    const ipHash = hashIp(ip);
    const ins = await db.from("pledger_faucet_log").insert({ ip_hash: ipHash, address: key });
    if (ins.error && !isMissingSchema(ins.error)) console.warn("[pledger] faucet log write failed", { code: ins.error.code });
  }

  try {
    const balance = await waitForBalance(address);
    return NextResponse.json({
      ok: true,
      address,
      balance: usd(balance),
      balanceUnits: balance.toString(),
      faucetTxs: Array.isArray(faucet.result) ? faucet.result : [],
    });
  } catch {
    return fail(502, "Test money was sent, but the balance could not be read yet. Try again in a moment.");
  }
}
