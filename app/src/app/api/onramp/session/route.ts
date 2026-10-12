import { NextResponse } from "next/server";
import { loadLine, payoutAddressFor } from "@/lib/claims-server";
import { buildOnrampParams, clientIp, friendlyStripeError, NOT_CONNECTED_MSG, parseTempoBody, type OnrampNetwork } from "@/lib/onramp";
import { ipOf, limit, tooMany, TEN_MIN } from "@/lib/ratelimit";
import { DB_MISSING, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * Mint a Stripe crypto onramp session that delivers USDC on Base straight to one claimant.
 * The wallet is locked server side, so the payer cannot change where funds go. Pledger never holds funds.
 *
 * Demo route: `{ network: "tempo", address, amountUsd? }` delivers USDC on Tempo to the demo pool's
 * test wallet instead. No database, nothing recorded; the donation is a separate step from that wallet.
 */
export async function POST(req: Request) {
  if (!limit("onramp-session", ipOf(req), 20, TEN_MIN)) return tooMany();
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return bad(NOT_CONNECTED_MSG, 503);

  let body: { payeeId?: string; network?: string };
  try {
    body = await req.json();
  } catch {
    return bad("Send payeeId");
  }

  if (body.network === "tempo") {
    const t = parseTempoBody(body);
    if ("error" in t) return bad(t.error);
    return mint(key, buildOnrampParams({ network: "tempo", address: t.address, remainingCents: t.amountCents, ip: clientIp(req.headers) }), "tempo");
  }

  const db = getSupabase();
  if (!db) return NextResponse.json(DB_MISSING, { status: 503 });
  const pid = String(body.payeeId ?? "");
  const payee = await payoutAddressFor(db, pid);
  if ("error" in payee) return bad(payee.error, payee.status);

  // Remaining owed: everything this person is owed, across all their places. Any `group` is ignored,
  // because the payment rule checks a transfer against the person's full remaining.
  let remainingCents = 0;
  try {
    const mine = (await loadLine(db)).filter((e) => e.pid === pid);
    remainingCents = mine.reduce((s, e) => s + Math.max(0, e.feeCents - e.paidCents), 0);
  } catch {
    remainingCents = 0; // amount is optional; the payer can enter it in the widget
  }

  return mint(key, buildOnrampParams({ address: payee.address, remainingCents, ip: clientIp(req.headers) }));
}

async function mint(key: string, params: URLSearchParams, network: OnrampNetwork = "base") {
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
  if (!res.ok) return bad(friendlyStripeError(j, network), res.status === 400 ? 400 : 502);

  return NextResponse.json({ clientSecret: j?.client_secret ?? null, redirectUrl: j?.redirect_url ?? null });
}
