// GET /api/pledges/p/[slug]/pool
// Live state of a self-serve pledge's MatchPool on Tempo testnet (same shape as /api/pools/test-match-pool).
// Only pools with a row in pledger_selfserve_pledges are read, so this cannot be pointed at any contract.
import { NextResponse } from "next/server";
import type { Address } from "viem";
import { getSelfServe } from "@/lib/selfserve-server";
import { readPool } from "@/lib/tempo";

export const revalidate = 10;

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cfg = await getSelfServe(slug);
  if (!cfg) return NextResponse.json({ error: "No pledge with that link." }, { status: 404 });
  try {
    return NextResponse.json(await readPool(cfg.address as Address, BigInt(cfg.deployBlock)));
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : "unknown error";
    return NextResponse.json({ error: `Could not read the pool on Tempo: ${msg}` }, { status: 502 });
  }
}
