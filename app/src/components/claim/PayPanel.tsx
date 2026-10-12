"use client";

import { useState } from "react";
import { useConnection, useConnect, useConnectors, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { Icon } from "@/components/Icons";
import { CardPay } from "./CardPay";
import { BASE_USDC, BASESCAN_TX, USDC_ABI } from "@/lib/base";
import { centsToUnits, formatCents, type LineEntry } from "@/lib/claims";

async function recordPayment(claimAddress: string, txHash: string): Promise<string> {
  const res = await fetch("/api/payments/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimAddress, txHash }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Could not check that payment");
  return `Payment of ${formatCents(j.amountCents)} recorded.`;
}

/** Pay one person in line with USDC on Base, or record a payment made elsewhere. */
export function PayPanel({ entry, onPaid }: { entry: LineEntry; onPaid: () => void }) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [hash, setHash] = useState<string | null>(null);

  const { isConnected, chainId } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const switchChain = useSwitchChain();
  const write = useWriteContract();
  const client = usePublicClient({ chainId: base.id });

  const remaining = Math.max(0, entry.feeCents - entry.paidCents);
  if (entry.status === "paid") return null;

  async function openPanel() {
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
      const tx = await write.mutateAsync({
        address: BASE_USDC,
        abi: USDC_ABI,
        functionName: "transfer",
        args: [address as `0x${string}`, centsToUnits(remaining)],
        chainId: base.id,
      });
      setHash(tx);
      setMsg("Sent. Waiting for Base to confirm…");
      if (client) await client.waitForTransactionReceipt({ hash: tx });
      setMsg(await recordPayment(address, tx));
      onPaid();
    } catch (e) {
      const m = e instanceof Error ? e.message : "Payment failed";
      setErr(/reject|denied/i.test(m) ? "Cancelled in your wallet" : m.split("\n")[0]!);
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
      <button className="btn btn-primary btn-sm cl-paybtn" onClick={openPanel} aria-expanded={open}>
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
              <button className="btn btn-primary" disabled={!address || busy || remaining === 0} onClick={pay}>
                {busy ? "Working…" : `Pay ${formatCents(remaining)}`}
                <span className="arr"><Icon name="arrow" /></span>
              </button>
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
          {msg && <span>{msg}</span>}
          {err && <span className="cl-error">{err}</span>}
        </div>
      )}
    </>
  );
}
