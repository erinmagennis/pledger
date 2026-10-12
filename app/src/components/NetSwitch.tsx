"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useNet, type Net } from "@/lib/network";

/** Approved by Erin, verbatim. Do not edit without her sign-off. */
export const MAINNET_WARNING =
  "You are switching to real money. Pledger has not had an external audit. Contracts and code are public and tested, but a bug could lose funds. Pledger never holds money, so losses would be from your own wallet. Testnet is the safe default.";
export const MAINNET_CHECKBOX = "I understand and I want to use mainnet.";

/** "Testnet | Mainnet" in the header. Mainnet asks for consent once per browser. */
export function NetSwitch() {
  const { net, setNet, acceptMainnet } = useNet();
  const [asking, setAsking] = useState(false);
  const [checked, setChecked] = useState(false);
  const mainBtn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const titleId = useId();

  function choose(next: Net) {
    if (next === net) return;
    if (!setNet(next)) {
      setChecked(false);
      setAsking(true);
    }
  }

  function close() {
    setAsking(false);
    mainBtn.current?.focus();
  }

  useEffect(() => {
    if (!asking) return;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asking]);

  return (
    <div className="netsw">
      <div className="netsw-seg" role="group" aria-label="Network">
        <button type="button" aria-pressed={net === "testnet"} onClick={() => choose("testnet")}>Testnet</button>
        <button type="button" ref={mainBtn} aria-pressed={net === "mainnet"} aria-expanded={asking} onClick={() => choose("mainnet")}>
          Mainnet
        </button>
      </div>
      {asking && (
        <div className="card netsw-panel" role="dialog" aria-modal="false" aria-labelledby={titleId}>
          <span className="k" id={titleId}><span className="netsw-dot" aria-hidden="true" />Switch to mainnet</span>
          <p className="netsw-p">{MAINNET_WARNING}</p>
          <label className="netsw-check">
            <input ref={box} type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>{MAINNET_CHECKBOX}</span>
          </label>
          <div className="netsw-acts">
            <button
              type="button"
              className="btn btn-primary btn-sm netsw-go"
              disabled={!checked}
              onClick={() => {
                acceptMainnet();
                setAsking(false);
              }}
            >
              Use mainnet
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Stay on testnet</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Thin full-width strip under the header while mainnet is on. */
export function MainnetBanner() {
  const { net, setNet } = useNet();
  if (net !== "mainnet") return null;
  return (
    <div className="netbar" role="status">
      <span>Mainnet: real money. No external audit yet.</span>
      <button type="button" onClick={() => setNet("testnet")}>Back to testnet</button>
    </div>
  );
}

/** A calm note, shown only while mainnet is on. */
export function MainnetOnly({ children }: { children: React.ReactNode }) {
  const { net } = useNet();
  return net === "mainnet" ? <>{children}</> : null;
}
