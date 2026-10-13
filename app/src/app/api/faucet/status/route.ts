// GET /api/faucet/status -> {down}
// Whether Tempo's public test faucet is working, for the /make form. Uses the last real faucet
// result when it is recent, else probes at most once a minute per instance (lib/faucet-status).
import { NextResponse } from "next/server";
import { faucetStatus } from "@/lib/faucet-status";
import { TEMPO_RPC } from "@/lib/tempo";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await faucetStatus(TEMPO_RPC);
  return NextResponse.json(s, { headers: { "cache-control": "no-store" } });
}
