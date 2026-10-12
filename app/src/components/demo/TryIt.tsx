"use client";

import { useCallback, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import type { OnrampSessionResult } from "@stripe/crypto";
import { Icon } from "../Icons";
import { CryptoElements, getOnramp, NARROW, OnrampElement, PK, TEST_MODE } from "../pay/StripeOnramp";
import { RECIPIENT_LABEL, txUrl, usd } from "@/lib/tempo";
import type { GiveResult } from "./give";

const KEY_STORE = "pledger_demo_key";
const AMOUNTS = [5, 10, 20] as const;
const ENOUGH = 20_000_000n; // $20 in 6-decimal units
const CARD_USD = 20;

type Phase = "idle" | "funding" | "ready" | "giving" | "done" | "error";
type StepState = "todo" | "now" | "done";

function readKey(): Hex | null {
  try {
    const k = window.sessionStorage.getItem(KEY_STORE);
    return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : null;
  } catch {
    return null;
  }
}

function saveKey(k: Hex) {
  try {
    window.sessionStorage.setItem(KEY_STORE, k);
  } catch {
    /* storage blocked: the key lives in memory for this visit */
  }
}

export function TryIt({ onGiven }: { onGiven: (r: GiveResult) => void }) {
  const keyRef = useRef<Hex | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [balance, setBalance] = useState<string>("");
  const [amount, setAmount] = useState<(typeof AMOUNTS)[number]>(10);
  const [giveStep, setGiveStep] = useState<"approving" | "donating" | "matched" | null>(null);
  const [result, setResult] = useState<GiveResult | null>(null);
  const [error, setError] = useState<string>("");
  const [address, setAddress] = useState<Address | null>(null);

  async function start() {
    setError("");
    setPhase("funding");
    try {
      const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
      const { balanceOf } = await import("./give");
      let key = keyRef.current ?? readKey();
      if (!key) {
        key = generatePrivateKey();
        saveKey(key);
      }
      keyRef.current = key;
      const address = privateKeyToAccount(key).address;
      setAddress(address);

      const have = await balanceOf(address).catch(() => 0n);
      if (have >= ENOUGH) {
        setBalance(usd(have));
        setPhase("ready");
        return;
      }
      const res = await fetch("/api/demo/fund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Test money could not be sent just now.");
      setBalance(data.balance);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test money could not be sent just now.");
      setPhase("error");
    }
  }

  async function giveNow() {
    const key = keyRef.current;
    if (!key) return start();
    setError("");
    setPhase("giving");
    setGiveStep("approving");
    try {
      const { give, balanceOf } = await import("./give");
      const r = await give(key, amount, (s) => setGiveStep(s));
      setGiveStep("matched");
      setResult(r);
      onGiven(r);
      balanceOf(r.who).then((b) => setBalance(usd(b))).catch(() => {});
      setPhase("done");
    } catch (e) {
      const msg = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : "";
      setError(`The gift did not go through. ${msg.split("\n")[0]}`.trim());
      setPhase("error");
    }
  }

  const fundState: StepState = phase === "funding" ? "now" : phase === "idle" ? "todo" : "done";
  const givingState: StepState =
    phase === "giving" && giveStep !== "matched" ? "now" : phase === "done" ? "done" : "todo";
  const matchedState: StepState = phase === "done" ? "done" : "todo";

  return (
    <div className="card try" id="try">
      <span className="k"><span className="live" />Demo match pool, test money only</span>
      <h2 style={{ marginTop: 8 }}>See a match happen</h2>
      <p className="try-sub">
        Give test money to {RECIPIENT_LABEL} and watch the pool match it. No login, no wallet. About a minute.
      </p>

      {phase === "idle" && (
        <div className="ctas">
          <button type="button" className="btn btn-primary" onClick={start}>
            Try it with test money
            <span className="arr"><Icon name="arrow" /></span>
          </button>
        </div>
      )}

      {phase !== "idle" && (
        <ol className="try-steps" aria-live="polite">
          <li className={fundState}><i />{fundState === "done" && balance ? "Test money ready" : "Getting test money"}</li>
          <li className={givingState}><i />{giveStep === "approving" && phase === "giving" ? "Giving (step 1 of 2)" : giveStep === "donating" && phase === "giving" ? "Giving (step 2 of 2)" : "Giving"}</li>
          <li className={matchedState}><i />Matched</li>
        </ol>
      )}

      {phase === "ready" && (
        <>
          <div className="try-amounts" role="radiogroup" aria-label="How much to give">
            {AMOUNTS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={amount === n}
                className={amount === n ? "on" : undefined}
                onClick={() => setAmount(n)}
              >
                ${n}
              </button>
            ))}
          </div>
          <div className="ctas">
            <button type="button" className="btn btn-primary" onClick={giveNow}>
              Give ${amount}
              <span className="arr"><Icon name="arrow" /></span>
            </button>
          </div>
        </>
      )}

      {phase === "done" && result && <Result r={result} onAgain={() => { setResult(null); setGiveStep(null); setPhase("ready"); }} />}

      {address && phase !== "funding" && <CardFund address={address} />}

      {phase === "error" && (
        <div className="try-error" role="alert">
          <p>{error}</p>
          <div className="ctas">
            <button type="button" className="btn btn-ghost" onClick={keyRef.current && balance ? () => setPhase("ready") : start}>
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Card step of the demo route: Stripe sells USDC on Tempo into this test wallet, locked to it.
 * Stripe cannot call the pool, so the gift still goes from the wallet. Sandbox only: no real
 * tokens arrive, and the faucet still supplies the test money for the gift.
 */
function CardFund({ address }: { address: Address }) {
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

  async function begin() {
    if (open) return setOpen(false);
    setOpen(true);
    if (secret || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/onramp/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ network: "tempo", address, amountUsd: CARD_USD }),
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
    <div className="try-card">
      <p className="try-note">
        The demo shows the whole route, from card to USDC on Tempo to a matched gift, with the card step in Stripe&rsquo;s sandbox.
      </p>
      <div className="try-card-row">
        <button type="button" className="btn btn-ghost" onClick={begin} aria-expanded={open}>
          Fund this test wallet by card
        </button>
        {TEST_MODE && <span className="chip try-test">Test mode</span>}
      </div>
      <p className="try-note">Sandbox: the card step is a demo. Test money for the donation still comes from the faucet.</p>
      {open && (
        <div className="try-card-pay" role="region" aria-label="Fund this test wallet by card">
          {busy && <p className="try-note">Loading…</p>}
          {err && <p className="try-card-err">{err}</p>}
          {done && <p>Card step done.</p>}
          {secret && !fallback && !done && (
            <CryptoElements stripeOnramp={getOnramp()}>
              <OnrampElement clientSecret={secret} onUpdate={onUpdate} onFail={onFail} className="try-onramp" />
            </CryptoElements>
          )}
          {secret && fallback && !done &&
            (redirect ? (
              <a className="btn btn-primary" href={redirect} target="_blank" rel="noreferrer">
                Open card payment in a new tab
              </a>
            ) : (
              <p className="try-card-err">Card payments could not load here. Try again on a computer.</p>
            ))}
        </div>
      )}
    </div>
  );
}

function Result({ r, onAgain }: { r: GiveResult; onAgain: () => void }) {
  const gave = usd(r.amountUnits);
  const matched = r.matchUnits > 0n;
  const total = usd(r.amountUnits + r.matchUnits);
  return (
    <div className="mini try-result">
      {matched ? (
        <p>
          You gave <b>{gave}</b>. The pool matched <b>{usd(r.matchUnits)}</b>. <b>{total}</b> went to {RECIPIENT_LABEL}.
        </p>
      ) : (
        <p>
          You gave <b>{gave}</b>, and it went to {RECIPIENT_LABEL}. Your $20 match was already used.
        </p>
      )}
      <p className="try-proof">
        <Icon name="check" small />
        {matched ? "Matched by the pool\u2019s own rules, checked on Tempo." : "The pool\u2019s own rules decided this, checked on Tempo."}
      </p>
      {!r.sponsored && <p className="try-note">The free fee service was busy, so this wallet paid a small fee in test money.</p>}
      <div className="try-links">
        <a href={txUrl(r.donateTx)} target="_blank" rel="noreferrer">Your gift on Tempo</a>
        {r.approveTx && <a href={txUrl(r.approveTx)} target="_blank" rel="noreferrer">The approval on Tempo</a>}
      </div>
      <div className="ctas">
        <button type="button" className="btn btn-ghost" onClick={onAgain}>Give again</button>
      </div>
    </div>
  );
}
