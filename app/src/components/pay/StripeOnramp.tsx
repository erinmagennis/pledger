"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { loadStripeOnramp, type OnrampSessionResult, type StripeOnramp } from "@stripe/crypto";

// Shared by the claim page (CardPay, Base) and the demo pool (TryIt, Tempo).
export const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
export const TEST_MODE = PK.startsWith("pk_test");
/** Under this width the hosted page opens in a new tab instead of the embedded widget. */
export const NARROW = 600;

let onrampPromise: Promise<StripeOnramp | null> | null = null;
export const getOnramp = () => (onrampPromise ??= loadStripeOnramp(PK).catch(() => null));

// CryptoElements / OnrampElement, as in Stripe's embedded onramp guide.
const Ctx = createContext<{ onramp: StripeOnramp | null; failed: boolean }>({ onramp: null, failed: false });

export function CryptoElements({ stripeOnramp, children }: { stripeOnramp: Promise<StripeOnramp | null>; children: ReactNode }) {
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

export function OnrampElement({
  clientSecret,
  onUpdate,
  onFail,
  className = "cl-onramp",
}: {
  clientSecret: string;
  onUpdate: (s: OnrampSessionResult) => void;
  onFail: () => void;
  className?: string;
}) {
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
  return <div ref={ref} className={className} />;
}
