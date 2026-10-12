import { NextResponse } from "next/server";
import { loadLine, payoutAddressFor } from "@/lib/claims-server";
import { buildOnrampParams, clientIp, friendlyStripeError, NOT_CONNECTED_MSG, NOTHING_OWED_MSG, parseTempoBody, TEMPO_SANDBOX_ONLY_MSG, tempoAllowed, type OnrampNetwork } from "@/lib/onramp";
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
 * It runs only with a Stripe test key (sk_test_): with a live key it answers 503.
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
  if (!body || typeof body !== "object") return bad("Send a JSON object");

  if (body.network === "tempo") {
    if (!tempoAllowed(key)) return bad(TEMPO_SANDBOX_ONLY_MSG, 503);
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
  // A paid entry (forgiven included) owes nothing, the same test as owedUnits.
  let remainingCents: number | null = null;
  try {
    const mine = (await loadLine(db)).filter((e) => e.pid === pid);
    remainingCents = mine.reduce((s, e) => s + (e.status === "paid" ? 0 : Math.max(0, e.feeCents - e.paidCents)), 0);
  } catch {
    remainingCents = null; // amount is optional; the payer can enter it in the widget
  }
  if (remainingCents === 0) return bad(NOTHING_OWED_MSG);

  return mint(key, buildOnrampParams({ address: payee.address, remainingCents: remainingCents ?? undefined, ip: clientIp(req.headers) }));
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
  if (!res.ok) {
    // Stripe's error code and message name the bad parameter; neither holds a secret.
    const e = (j as { error?: { code?: string; message?: string; param?: string } } | null)?.error;
    console.warn("[pledger] stripe onramp error", { status: res.status, code: e?.code, param: e?.param, message: e?.message });
    return NextResponse.json({ error: friendlyStripeError(j, network), stripeCode: e?.code ?? null }, { status: res.status === 400 ? 400 : 502 });
  }

  return NextResponse.json({ clientSecret: j?.client_secret ?? null, redirectUrl: j?.redirect_url ?? null });
}
