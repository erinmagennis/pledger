"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../Icons";
import { useNet } from "@/lib/network";
import {
  MAX_LOCK_DAYS,
  MAX_POOL_USD,
  RATIOS,
  dollars,
  matchFor,
  ratioToBps,
  validatePledgeInput,
  type Invalid,
  type Ratio,
} from "@/lib/selfserve";

const RATIO_LABEL: Record<Ratio, string> = { "1:2": "50¢ per $1", "1:1": "$1 per $1", "2:1": "$2 per $1", "3:1": "$3 per $1" };
const POOL_PICKS = [100, 250, 500];

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The /make form. Testnet only: on mainnet it shows a short note instead. */
export function MakeForm() {
  const { net } = useNet();
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const minDay = isoDay(new Date(today.getTime() + 86400000));
  const maxDay = isoDay(new Date(today.getTime() + (MAX_LOCK_DAYS - 1) * 86400000));
  const defaultDay = isoDay(new Date(today.getTime() + 30 * 86400000));

  const [name, setName] = useState("");
  const [pool, setPool] = useState("250");
  const [ratio, setRatio] = useState<Ratio>("1:1");
  const [cap, setCap] = useState("25");
  const [lock, setLock] = useState(defaultDay);
  const [own, setOwn] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [errors, setErrors] = useState<Invalid["errors"]>({});
  const [busy, setBusy] = useState(false);

  if (net === "mainnet") {
    return (
      <div className="card ss-form ss-mainnet">
        <span className="k"><span className="live still" />Mainnet</span>
        <h2>Self-serve pledges run on testnet for now.</h2>
        <p>Mainnet is next.</p>
      </div>
    );
  }

  const body = { name, poolUsd: pool, ratio, capUsd: cap, lockUntil: lock, recipient: own ? recipient : "" };
  const example = 10;
  const exMatch = Math.min(matchFor(example, ratioToBps(ratio)), Number(cap) || 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validatePledgeInput(body);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await fetch("/api/pledges/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setErrors(j.errors ?? { form: j.error ?? "The pledge could not be made just now." });
        setBusy(false);
        return;
      }
      router.push(j.url);
    } catch {
      setErrors({ form: "The pledge could not be made just now. Check your connection and try again." });
      setBusy(false);
    }
  }

  const err = (k: keyof Invalid["errors"]) => errors[k] && <p className="ss-err" role="alert">{errors[k]}</p>;

  return (
    <form className="card ss-form" onSubmit={submit} noValidate>
      <span className="k"><span className="live" />Runs on Tempo testnet with test money</span>
      <h2>Set up a match</h2>

      <label className="ss-field">
        <span>Pledge name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Spring match for the tool library" />
        {err("name")}
      </label>

      <div className="ss-field">
        <span>Match pool</span>
        <div className="ss-money">
          <i>$</i>
          <input inputMode="decimal" value={pool} onChange={(e) => setPool(e.target.value)} aria-label="Match pool in dollars" />
        </div>
        <div className="ss-picks">
          {POOL_PICKS.map((p) => (
            <button type="button" key={p} className={String(p) === pool ? "on" : undefined} onClick={() => setPool(String(p))}>${p}</button>
          ))}
        </div>
        <small>Up to ${MAX_POOL_USD} of test money.</small>
        {err("poolUsd")}
      </div>

      <div className="ss-field">
        <span>Match ratio</span>
        <div className="ss-seg" role="radiogroup" aria-label="Match ratio">
          {RATIOS.map((r) => (
            <button type="button" role="radio" aria-checked={ratio === r} key={r} className={ratio === r ? "on" : undefined} onClick={() => setRatio(r)}>
              <b>{r}</b>
              <small>{RATIO_LABEL[r]}</small>
            </button>
          ))}
        </div>
        {err("ratio")}
      </div>

      <div className="ss-row">
        <label className="ss-field">
          <span>Cap per donor</span>
          <div className="ss-money">
            <i>$</i>
            <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Cap per donor in dollars" />
          </div>
          {err("capUsd")}
        </label>
        <label className="ss-field">
          <span>Locked until</span>
          <input type="date" value={lock} min={minDay} max={maxDay} onChange={(e) => setLock(e.target.value)} />
          {err("lockUntil")}
        </label>
      </div>

      <div className="ss-field">
        <span>Goes to</span>
        <div className="ss-choice">
          <label className={!own ? "on" : undefined}>
            <input type="radio" name="to" checked={!own} onChange={() => setOwn(false)} />
            <span><b>A test project</b><small>We fill in a test address for you.</small></span>
          </label>
          <label className={own ? "on" : undefined}>
            <input type="radio" name="to" checked={own} onChange={() => setOwn(true)} />
            <span><b>My own address</b><small>Paste a 0x address on Tempo testnet.</small></span>
          </label>
        </div>
        {own && <input className="ss-addr" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..." spellCheck={false} aria-label="Recipient address" />}
        {err("recipient")}
      </div>

      <div className="ss-preview" aria-live="polite">
        <Icon name="heart" small />
        <p>
          When someone gives <b>{dollars(example)}</b>, the pool adds <b>{dollars(exMatch)}</b>. <b>{dollars(example + exMatch)}</b> arrives together.
        </p>
      </div>

      {err("form")}
      <div className="ctas">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Setting it up, about 30 seconds" : "Make this pledge"}
          <span className="arr"><Icon name="arrow" /></span>
        </button>
      </div>
      <p className="ss-fine">Test pledges get their own page you can share by link. They are not listed on Pledger. Three a day per visitor.</p>
    </form>
  );
}
