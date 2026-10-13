// POST /api/pledges/create {name, poolUsd, ratio, capUsd, lockUntil, recipient?}
// Makes a self-serve match pledge on Tempo testnet: a new MatchPool, funded with faucet test money,
// and a row in pledger_selfserve_pledges (sql/008). Testnet only; there is no mainnet path here.
// Limits: 3 pledges per visitor (IP hash) and 40 overall per 24 hours, stored in the table so they
// hold across instances; plus one create at a time per IP and at most 3 at once, in memory.
import { NextResponse, type NextRequest } from "next/server";
import { ipOf } from "@/lib/ratelimit";
import { deployAndFund } from "@/lib/selfserve-chain";
import { createPledge } from "@/lib/selfserve-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const inFlight = new Set<string>();
const MAX_AT_ONCE = 3;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Send the form as JSON." }, { status: 400 });
  }
  const ip = ipOf(req);
  if (inFlight.has(ip)) return NextResponse.json({ ok: false, error: "Your last pledge is still being made. Give it a minute." }, { status: 429 });
  if (inFlight.size >= MAX_AT_ONCE) return NextResponse.json({ ok: false, error: "A few pledges are being made right now. Try again in a minute." }, { status: 429 });
  inFlight.add(ip);
  try {
    const r = await createPledge(body, ip, (input, recipient) => deployAndFund(input, recipient));
    return NextResponse.json(r.body, { status: r.status });
  } finally {
    inFlight.delete(ip);
  }
}
