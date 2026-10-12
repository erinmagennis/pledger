"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { loadStripeOnramp, type OnrampSessionResult, type StripeOnramp } from "@stripe/crypto";
import type { LineEntry } from "@/lib/claims";

const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const TEST_MODE = PK.startsWith("pk_test");
const NARROW = 600;

let onrampPromise: Promise<StripeOnramp | null> | null = null;
const getOnramp = () => (onrampPromise ??= loadStripeOnramp(PK).catch(() => null));

// CryptoElements / OnrampElement, as in Stripe's embedded onramp guide.
const Ctx = createContext<{ onramp: StripeOnramp | null; failed: boolean }>({ onramp: null, failed: false });

function CryptoElements({ stripeOnramp, children }: { stripeOnramp: Promise<StripeOnramp | null>; children: ReactNode }) {
  const [ctx, setCtx] = useState<{ onramp: StripeOnramp | null; failed: boolean }>({ onramp: null, failed: false });
  useEffect(() => {
    let live = true;
    stripeOnramp.then((o) => live && setCtx(o ? { onramp: o, failed: false } : { onramp: null, failed: true }));
    return () => {
      live = false;
    };
  }, [stripeOnramp]);
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

function OnrampElement({ clientSecret, onUpdate, onFail }: { clientSecret: string; onUpdate: (s: OnrampSessionResult) => void; onFail: () => void }) {
  const { onramp, failed } = useContext(Ctx);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failed) onFail();
  }, [failed, onFail]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onramp) return;
    el.innerHTML = "";
    try {
      onramp
        .createSession({ clientSecret })
        .addEventListener("onramp_session_updated", (e) => onUpdate(e.payload.session))
        .mount(el);
    } catch {
      onFail();
    }
  }, [clientSecret, onramp, onUpdate, onFail]);
  return <div ref={ref} className="cl-onramp" />;
}

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
        body: JSON.stringify({ payeeId: entry.pid, group: entry.group }),
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
