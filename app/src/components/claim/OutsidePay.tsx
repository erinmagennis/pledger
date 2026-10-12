"use client";

// "I'm paying this outside Pledger": hold the person for 10 minutes, then show the exact amount and the
// full address to send to from any wallet or exchange. The full address appears only after the click.
import { useState } from "react";
import Link from "next/link";
import { HOLD_MINUTES, formatCentsExact, type LineEntry } from "@/lib/claims";
import { hold } from "./holds";

type Shown = { held: boolean; address: string; owedCents: number };

/** What this person owes right now across all their places, from the live line (same sum as Pay). */
async function owedNow(pid: string): Promise<number> {
  const res = await fetch("/api/line", { cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(j.line)) throw new Error(j.error || "Could not load the line");
  return (j.line as LineEntry[]).filter((e) => e.pid === pid && e.status !== "paid").reduce((s, e) => s + Math.max(0, e.feeCents - e.paidCents), 0);
}

async function addressOf(pid: string): Promise<string> {
  const res = await fetch(`/api/line/payee?pid=${encodeURIComponent(pid)}`);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || typeof j.address !== "string") throw new Error(j.error || "Could not load the address");
  return j.address;
}

/** `hasPay` is true where the row has a Pay button (the full line page) to paste the transaction into. */
export function OutsidePay({ pid, hasPay }: { pid: string; hasPay: boolean }) {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const [h, address, owedCents] = await Promise.all([hold([pid], "outside"), addressOf(pid), owedNow(pid)]);
      setShown({ held: h.held, address, owedCents });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the address");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr("Could not copy. Select the address and copy it by hand.");
    }
  }

  if (!shown) {
    return (
      <div className="cl-outside-start">
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={start}>
          {busy ? "Working…" : "I'm paying this outside Pledger"}
        </button>
        {err && <span className="cl-error">{err}</span>}
      </div>
    );
  }

  if (shown.owedCents <= 0) return <p className="cl-outside">Nothing is owed to this person right now.</p>;

  const amount = formatCentsExact(shown.owedCents);
  return (
    <div className="cl-outside" aria-live="polite">
      <span>
        {shown.held ? `Held for you for ${HOLD_MINUTES} minutes. ` : ""}Send exactly <b>{amount} USDC</b> on Base to
      </span>
      <div className="cl-copy">
        <span className="cl-addr">{shown.address}</span>
        <button className="btn btn-ghost btn-sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <span className="cl-soft">
        {hasPay ? (
          "After you send, press Pay and paste the transaction link so the line updates."
        ) : (
          <>After you send, paste the transaction link on the <Link href="/claim/line">full line</Link> so it updates.</>
        )}
      </span>
      {err && <span className="cl-error">{err}</span>}
    </div>
  );
}
