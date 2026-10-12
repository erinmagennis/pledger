import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { fulfilledTransfer, verifyStripeSignature } from "@/lib/onramp";
import { recordUsdcPayment } from "@/lib/payments-server";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook for crypto.onramp_session.updated. On fulfillment_complete, the on-chain tx
 * is checked on Base and recorded like any other payment. Safe to receive more than once.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });

  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }

  const t = fulfilledTransfer(event);
  if (!t) return NextResponse.json({ received: true, recorded: false });

  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 }); // Stripe retries

  const r = await recordUsdcPayment(db, t.to, t.txHash as Hex);
  if (r.ok) return NextResponse.json({ received: true, recorded: true });
  if (r.duplicate) return NextResponse.json({ received: true, recorded: false, already: true });
  // Not on Base yet or a DB hiccup: ask Stripe to retry. Anything else is final.
  if (r.status >= 500 || r.error.startsWith("Transaction not found")) {
    return NextResponse.json({ error: r.error }, { status: 503 });
  }
  return NextResponse.json({ received: true, recorded: false, reason: r.error });
}
