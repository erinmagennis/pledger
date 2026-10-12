"use client";

import { useEffect, useRef, useState } from "react";
import { useConnection, useConnect, useConnectors, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { Icon } from "@/components/Icons";
import { CardPay } from "./CardPay";
import { BASE_USDC, BASESCAN_TX, USDC_ABI } from "@/lib/base";
import { centsToUnits, formatCents, type LineEntry } from "@/lib/claims";
import { forgetSent, hold, isMine, loadSent, rememberSent, sentId, useMyHolds, worthRetrying } from "./holds";

/** Thrown when a payment could not be recorded. `final` is the rule saying no for good; otherwise check again later. */
class RecordError extends Error {
  constructor(message: string, readonly final: boolean) {
    super(message);
  }
}

async function recordPayment(claimAddress: string, txHash: string): Promise<string> {
  const res = await fetch("/api/payments/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimAddress, txHash }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 409 && /already recorded/i.test(j.error ?? "")) return "This payment is already recorded.";
  if (!res.ok) {
    const error = j.error || "Could not check that payment";
    throw new RecordError(error, !worthRetrying(res.status, error));
  }
  // Real money that did not match what was owed: stored as an extra and shown on the row, never counted.
  if (j.kind === "extra" && j.message) return String(j.message);
  return `Payment of ${formatCents(j.amountCents)} recorded.`;
}

/** Record a tx this panel sent, and forget it in this browser once it is recorded or turned away for good. */
async function recordSent(claimAddress: string, txHash: string): Promise<string> {
  const id = sentId({ address: claimAddress, txs: [txHash] });
  try {
    const m = await recordPayment(claimAddress, txHash);
    forgetSent([id]);
    return m;
  } catch (e) {
    if (e instanceof RecordError && e.final) forgetSent([id]);
    throw e;
  }
}

/** What this person owes right now across all their places, from the live line. */
async function currentOwed(pid: string): Promise<number> {
  const res = await fetch("/api/line", { cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(j.line)) throw new Error(j.error || "Could not load the line");
  return (j.line as LineEntry[]).filter((e) => e.pid === pid).reduce((s, e) => s + Math.max(0, e.feeCents - e.paidCents), 0);
}

/** People whose earlier payment one panel on this page is already checking again. */
const replayedPids = new Set<string>();

/**
 * Pay one person in line with USDC on Base, or record a payment made elsewhere.
 * `owedCents` is everything the person still owes (a payment only counts when it is the full amount).
 */
export function PayPanel({ entry, owedCents, onPaid }: { entry: LineEntry; owedCents: number; onPaid: () => void }) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [hash, setHash] = useState<string | null>(null);
  // True while a payment sent on an earlier visit (kept in this browser) is checked again.
  const [replaying, setReplaying] = useState(false);
  const replayed = useRef(false);

  const { isConnected, chainId } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const switchChain = useSwitchChain();
  const write = useWriteContract();
  const client = usePublicClient({ chainId: base.id });
  useMyHolds();
  // Someone else is paying this person now: Pay waits (the row shows the hold beside the button). The list re-renders
  // this panel as the hold runs out.
  const heldByOther = !!entry.held && !!entry.heldUntil && Date.parse(entry.heldUntil) > Date.now() && !isMine(entry.pid);

  // A payment to this person sent on an earlier visit and never recorded: check it again, once per page.
  // A person can have two rows (two groups); the first one does it. This runs even when the row shows paid
  // (someone else may have paid too, or it was paid outside): the server decides, and an extra is kept as an extra.
  useEffect(() => {
    if (replayed.current) return;
    replayed.current = true;
    const stored = loadSent("pay").find((s) => s.pid === entry.pid);
    if (!stored || replayedPids.has(entry.pid)) return;
    replayedPids.add(entry.pid);
    const tx = stored.txs[0]!;
    setAddress(stored.address);
    setHash(tx);
    setOpen(true);
    setReplaying(true);
    setBusy(true);
    recordSent(stored.address, tx)
      .then((m) => {
        setMsg(m);
        onPaid();
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not check that payment"))
      .finally(() => {
        setReplaying(false);
        setBusy(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remaining = Math.max(0, owedCents);
  if (entry.status === "paid") {
    // Only the answer for a payment sent earlier shows on a paid row; nothing is left to pay.
    if (!replaying && !msg && !err) return null;
    return (
      <div className="cl-pay" aria-live="polite">
        {hash && <a className="cl-soft" href={BASESCAN_TX + hash} target="_blank" rel="noreferrer">View on Basescan</a>}
        {replaying && <span className="cl-soft">Checking a payment you sent earlier…</span>}
        {msg && <span>{msg}</span>}
        {err && <span className="cl-error">{err}</span>}
      </div>
    );
  }

  async function openPanel() {
    // Opening holds this person for 10 minutes, so "Help pay people back" sends other helpers to the next people.
    if (!open) void hold([entry.pid], "pledger");
    setOpen((o) => !o);
    if (address) return;
    try {
      const r = await fetch(`/api/line/payee?pid=${entry.pid}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load the address");
      setAddress(j.address);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the address");
    }
  }

  async function pay() {
    if (!address) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (chainId !== base.id) await switchChain.mutateAsync({ chainId: base.id });
      // Someone else may have paid this person since the page loaded.
      if ((await currentOwed(entry.pid)) !== remaining) {
        setErr("The line changed, check it again");
        onPaid();
        return;
      }
      // Refresh the hold as the payer signs.
      await hold([entry.pid], "pledger");
      const tx = await write.mutateAsync({
        address: BASE_USDC,
        abi: USDC_ABI,
        functionName: "transfer",
        args: [address as `0x${string}`, centsToUnits(remaining)],
        chainId: base.id,
      });
      setHash(tx);
      rememberSent([{ from: "pay", pid: entry.pid, address, amountUnits: centsToUnits(remaining).toString(), txs: [tx], label: entry.label, at: Date.now() }]);
      setMsg("Sent. Waiting for Base to confirm…");
      if (client) {
        const receipt = await client.waitForTransactionReceipt({ hash: tx });
        if (receipt.status !== "success") {
          setHash(null); // nothing moved, so paying again is safe
          forgetSent([sentId({ address, txs: [tx] })]);
          throw new Error("That payment failed on Base");
        }
      }
      setMsg(await recordSent(address, tx));
      onPaid();
    } catch (e) {
      const m = e instanceof Error ? e.message : "Payment failed";
      setErr(/reject|denied/i.test(m) ? "Cancelled in your wallet" : m.split("\n")[0]!);
    } finally {
      setBusy(false);
    }
  }

  /** Re-check the payment already sent, instead of sending a second one. */
  async function checkAgain() {
    if (!address || !hash) return;
    setBusy(true);
    setErr(null);
    try {
      setMsg(await recordSent(address, hash));
      onPaid();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not check that payment");
    } finally {
      setBusy(false);
    }
  }

  async function submitPasted() {
    if (!address || !pasted.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      setMsg(await recordPayment(address, pasted));
      setPasted("");
      onPaid();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not check that payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn btn-primary btn-sm cl-paybtn" onClick={openPanel} aria-expanded={open} disabled={heldByOther && !open}>
        Pay<span className="arr"><Icon name="arrow" small /></span>
      </button>
      {open && (
        <div className="cl-pay">
          <span>
            Send <b>{formatCents(remaining)} USDC</b> on Base to {entry.label}:
          </span>
          <span className="cl-addr">{address ?? "Loading address…"}</span>
          <span className="cl-soft">Check the address in your wallet before you confirm.</span>
          {!isConnected ? (
            <div className="cl-row">
              {connectors.map((c) => (
                <button key={c.uid} className="btn btn-ghost" onClick={() => connect.mutate({ connector: c, chainId: base.id })}>
                  {c.id === "injected" ? "Browser wallet" : c.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="cl-row">
              {hash ? (
                <button className="btn btn-primary" disabled={busy} onClick={checkAgain}>
                  {busy ? "Working…" : "Check again"}
                </button>
              ) : (
                <button className="btn btn-primary" disabled={!address || busy || remaining === 0 || heldByOther} onClick={pay}>
                  {busy ? "Working…" : `Pay ${formatCents(remaining)}`}
                  <span className="arr"><Icon name="arrow" /></span>
                </button>
              )}
            </div>
          )}
          <CardPay entry={entry} />
          <label className="cl-soft" htmlFor={`paste-${entry.pid}-${entry.group}`}>Paid outside Pledger? Paste the transaction link</label>
          <div className="cl-row">
            <input
              id={`paste-${entry.pid}-${entry.group}`}
              className="cl-input"
              style={{ flex: "1 1 240px" }}
              placeholder="https://basescan.org/tx/0x…"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <button className="btn btn-ghost" disabled={busy || !pasted.trim() || !address} onClick={submitPasted}>Check</button>
          </div>
          {hash && <a className="cl-soft" href={BASESCAN_TX + hash} target="_blank" rel="noreferrer">View on Basescan</a>}
          {replaying && <span className="cl-soft">Checking a payment you sent earlier…</span>}
          {msg && <span>{msg}</span>}
          {err && <span className="cl-error">{err}</span>}
        </div>
      )}
    </>
  );
}
