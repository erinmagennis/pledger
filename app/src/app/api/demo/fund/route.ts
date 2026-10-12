// POST /api/demo/fund {address}
// Funds a throwaway browser wallet with Tempo testnet stablecoins via the public faucet.
// In-memory rate limit: 3 fundings per IP per hour, 1 per address. Resets on server restart,
// and each serverless instance keeps its own counts. Good enough for test money.
import { NextResponse, type NextRequest } from "next/server";
import { getAddress, isAddress, type Address } from "viem";
import { TEMPO_RPC, alphaBalance, usd } from "@/lib/tempo";

export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
const PER_IP = 3;
const ipHits = new Map<string, number[]>();
const fundedAddresses = new Set<string>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
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

  let faucet: { result?: unknown; error?: { message?: string } };
  try {
    const res = await fetch(TEMPO_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tempo_fundAddress", params: [address] }),
      cache: "no-store",
    });
    if (!res.ok) return fail(502, `The Tempo test faucet answered with status ${res.status}. Try again in a minute.`);
    faucet = await res.json();
  } catch {
    return fail(502, "The Tempo test faucet could not be reached. Try again in a minute.");
  }
  if (faucet.error) {
    return fail(502, `The Tempo test faucet said: ${faucet.error.message ?? "unknown error"}.`);
  }

  hits.push(now);
  ipHits.set(ip, hits);
  fundedAddresses.add(key);

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
