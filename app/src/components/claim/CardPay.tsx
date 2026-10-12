"use client";

import { useCallback, useState } from "react";
import type { OnrampSessionResult } from "@stripe/crypto";
import type { LineEntry } from "@/lib/claims";
import { CryptoElements, getOnramp, NARROW, OnrampElement, PK, TEST_MODE } from "../pay/StripeOnramp";

/** Pay one person by card. Stripe sells USDC on Base and sends it straight to their wallet. */
export function CardPay({ entry }: { entry: LineEntry }) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [redirect, setRedirect] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const onUpdate = useCallback((s: OnrampSessionResult) => {
    if (s.status === "fulfillment_complete") setDone(true);
  }, []);
  const onFail = useCallback(() => setFallback(true), []);

  if (!PK) return null;

  async function start() {
    if (open) return setOpen(false);
    setOpen(true);
    if (secret || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/onramp/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // No group: the payment rule checks the person's full remaining, so the session asks for that.
        body: JSON.stringify({ payeeId: entry.pid }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.clientSecret) throw new Error(j.error || "Could not start a card payment");
      setSecret(j.clientSecret);
      setRedirect(j.redirectUrl ?? null);
      if (window.innerWidth < NARROW && j.redirectUrl) {
        setFallback(true);
        window.open(j.redirectUrl, "_blank", "noopener");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start a card payment");
    } finally {
      setBusy(false);
    }
  }


  return (
    <>
      <div className="cl-row">
        <button className="btn btn-ghost" onClick={start} aria-expanded={open}>
          Pay by card
        </button>
        {TEST_MODE && <span className="chip cl-wait cl-test">Test mode</span>}
      </div>
      <span className="cl-soft">Keep the amount as shown. A different amount cannot be matched to this person.</span>
      {open && (
        <div className="cl-cardpay" role="region" aria-label="Pay by card">
          <span className="cl-soft">Stripe sends USDC on Base straight to {entry.label}. Pledger never holds the money.</span>
          {busy && <span className="cl-soft">Loading…</span>}
          {err && <span className="cl-error">{err}</span>}
          {done && <span>Payment sent. It shows in the line once it lands on Base.</span>}
          {secret && !fallback && !done && (
            <CryptoElements stripeOnramp={getOnramp()}>
              <OnrampElement clientSecret={secret} onUpdate={onUpdate} onFail={onFail} />
            </CryptoElements>
          )}
          {secret && fallback && !done &&
            (redirect ? (
              <a className="btn btn-primary" href={redirect} target="_blank" rel="noreferrer">
                Open card payment in a new tab
              </a>
            ) : (
              <span className="cl-error">Card payments could not load here. Try again on a computer.</span>
            ))}
        </div>
      )}
    </>
  );
}
