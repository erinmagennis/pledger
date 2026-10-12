import { NextResponse } from "next/server";
import { loadLine, payoutAddressFor } from "@/lib/claims-server";
import { buildOnrampParams, clientIp, friendlyStripeError, NOT_CONNECTED_MSG } from "@/lib/onramp";
import { DB_MISSING, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * Mint a Stripe crypto onramp session that delivers USDC on Base straight to one claimant.
 * The wallet is locked server side, so the payer cannot change where funds go. Pledger never holds funds.
 */
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return bad(NOT_CONNECTED_MSG, 503);
  const db = getSupabase();
  if (!db) return NextResponse.json(DB_MISSING, { status: 503 });

  let body: { payeeId?: string; group?: number };
  try {
    body = await req.json();
  } catch {
    return bad("Send payeeId");
  }
  const pid = String(body.payeeId ?? "");
  const payee = await payoutAddressFor(db, pid);
  if ("error" in payee) return bad(payee.error, payee.status);

  // Remaining owed: one line entry when group is given, else everything this person is owed.
  let remainingCents = 0;
  try {
    const mine = (await loadLine(db)).filter((e) => e.pid === pid && (body.group === undefined || e.group === body.group));
    remainingCents = mine.reduce((s, e) => s + Math.max(0, e.feeCents - e.paidCents), 0);
  } catch {
    remainingCents = 0; // amount is optional; the payer can enter it in the widget
  }

  const params = buildOnrampParams({ address: payee.address, remainingCents, ip: clientIp(req.headers) });
  let res: Response;
  try {
    res = await fetch("https://api.stripe.com/v1/crypto/onramp_sessions", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params,
      cache: "no-store",
    });
  } catch {
    return bad("Could not reach Stripe. Try again.", 502);
  }
  const j = await res.json().catch(() => null);
  if (!res.ok) return bad(friendlyStripeError(j), res.status === 400 ? 400 : 502);

  return NextResponse.json({ clientSecret: j?.client_secret ?? null, redirectUrl: j?.redirect_url ?? null });
}
