"use client";

import { useRef, useState } from "react";
import type { Hex } from "viem";
import { Icon } from "../Icons";
import { RECIPIENT_LABEL, txUrl, usd } from "@/lib/tempo";
import type { GiveResult } from "./give";

const KEY_STORE = "pledger-demo-key";
const AMOUNTS = [5, 10, 20] as const;
const ENOUGH = 20_000_000n; // $20 in 6-decimal units

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
      <span className="k"><span className="live" />Tempo testnet, test money only</span>
      <h2 style={{ marginTop: 8 }}>See a match happen</h2>
      <p className="try-sub">
        Give test money to {RECIPIENT_LABEL} and watch the pool match it. No login, no wallet. About a minute.
      </p>

      {phase === "idle" && (
        <div className="ctas">
          <button type="button" className="btn btn-primary" onClick={start}>
            Try it
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
          You gave <b>{gave}</b>, and it went to {RECIPIENT_LABEL}. This match is used up for this wallet.
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
