"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useConnection, useConnect, useConnectors, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { Icon } from "@/components/Icons";
import {
  claimMessage,
  formatCents,
  initialsOf,
  shortAddress,
  summarize,
  type DisplayMode,
  type ReviewRow,
} from "@/lib/claims";
import { EmailHelp } from "./EmailHelp";

type Done = { claimed: number; totalCents: number; place: number | null; nextUpdate: string };

function fmtDate(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Plain words for wallet connection errors (wagmi's own messages are technical). */
function connectError(e: Error): string {
  const m = `${e.name} ${e.message}`;
  if (/ProviderNotFound|provider not found|not installed|no provider/i.test(m)) return "That wallet is not installed in this browser";
  if (/UserRejected|reject|denied|cancel|closed/i.test(m)) return "You closed the wallet window";
  return "Could not connect. Try another wallet";
}

function rowChip(r: ReviewRow) {
  if (!r.ok) return <span className="chip cl-no">Not counted</span>;
  if (r.kind === "sold") return <span className="chip cl-no">Sale email</span>;
  if (r.selfBacked) return <span className="chip cl-self">Self-backed</span>;
  return <span className="chip cl-ok">Counts</span>;
}

export function ClaimFlow() {
  const { address, isConnected, chainId } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const switchChain = useSwitchChain();
  const sign = useSignMessage();

  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [dragOn, setDragOn] = useState(false);
  const [mode, setMode] = useState<DisplayMode>("initials");
  const [name, setName] = useState("");
  const [noChargeback, setNoChargeback] = useState(false);
  const [notRestricted, setNotRestricted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const summary = rows ? summarize(rows) : null;
  const claimable = rows?.filter((r) => r.ok && r.kind === "receipt" && r.fingerprint) ?? [];
  const needsName = mode !== "project";
  const wrongChain = isConnected && chainId !== base.id;
  const canSubmit = isConnected && !wrongChain && claimable.length > 0 && (!needsName || name.trim().length > 0) && noChargeback && notRestricted && !sending;

  async function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter((f) => f.name.toLowerCase().endsWith(".eml") || f.type === "message/rfc822");
    if (!incoming.length) {
      setError("Add .eml files. In your inbox, download the original email.");
      return;
    }
    const byKey = new Map(files.map((f) => [`${f.name}|${f.size}`, f]));
    for (const f of incoming) byKey.set(`${f.name}|${f.size}`, f);
    const next = [...byKey.values()];
    setFiles(next);
    setError(null);
    setChecking(true);
    try {
      const fd = new FormData();
      next.forEach((f) => fd.append("files", f));
      const res = await fetch("/api/claims/verify", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not check the files");
      setRows(json.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check the files");
    } finally {
      setChecking(false);
    }
  }

  function clearFiles() {
    setFiles([]);
    setRows(null);
    setError(null);
  }

  async function submit() {
    if (!address || !canSubmit) return;
    setSending(true);
    setError(null);
    try {
      const payload = {
        fingerprints: claimable.map((r) => r.fingerprint!),
        payout: address,
        display: { mode, name: needsName ? name : "" },
        noChargeback: true as const,
        notRestrictedRegion: true as const,
        timestamp: Date.now(),
      };
      const signature = await sign.mutateAsync({ message: claimMessage(payload) });
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      fd.append("payload", JSON.stringify(payload));
      fd.append("signature", signature);
      fd.append("address", address);
      const res = await fetch("/api/claims/submit", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not send the claim");
      setDone(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not send the claim";
      setError(/reject|denied/i.test(msg) ? "Signature cancelled in your wallet" : msg.split("\n")[0]!);
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="card cl-done">
        <span className="k"><span className="live" />Claim saved</span>
        {done.place !== null && <div className="cl-place" style={{ marginTop: 14 }}>#{done.place}</div>}
        <h2>{done.place !== null ? "Your place in line" : "You are in line"}</h2>
        <p className="cl-soft" style={{ marginTop: 8 }}>
          {done.claimed} receipt{done.claimed === 1 ? "" : "s"}, {formatCents(done.totalCents)} in fees. Payments go to{" "}
          {address ? shortAddress(address) : "your wallet"} in USDC on Base.
        </p>
        <div className="ctas" style={{ marginTop: 22 }}>
          <Link className="btn btn-primary" href="/claim/line">
            See the line<span className="arr"><Icon name="arrow" /></span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cl-steps">
      <div className="card cl-step">
        <span className="k"><b>1</b>Connect</span>
        <h2>Connect your wallet</h2>
        <p className="cl-soft">This wallet is your account and where your payment goes. USDC on Base.</p>
        {isConnected && address ? (
          <div className="cl-row">
            <span className="cl-pill"><span className="live" />{shortAddress(address)}</span>
            {wrongChain ? (
              <button className="btn btn-primary btn-sm" onClick={() => switchChain.mutate({ chainId: base.id })}>
                Switch to Base<span className="arr"><Icon name="arrow" small /></span>
              </button>
            ) : (
              <span className="chip cl-ok">Base</span>
            )}
            <button className="cl-link" onClick={() => disconnect()}>Disconnect</button>
          </div>
        ) : (
          <div className="cl-row">
            {connectors.map((c) => (
              <button key={c.uid} className="btn btn-ghost" disabled={connect.isPending} onClick={() => connect.mutate({ connector: c, chainId: base.id })}>
                {c.id === "injected" ? "Browser wallet" : c.name}
              </button>
            ))}
          </div>
        )}
        {!isConnected && <p className="cl-soft">No wallet? Coinbase Wallet makes one in a minute.</p>}
        {connect.error && <p className="cl-error">{connectError(connect.error)}</p>}
      </div>

      <div className="card cl-step">
        <span className="k"><b>2</b>Emails</span>
        <h2>Add your Artizen emails</h2>
        <p className="cl-soft">Your receipts (&ldquo;You collected&hellip;&rdquo;). If you backed your own project, add the &ldquo;You sold&hellip;&rdquo; email too.</p>
        <label
          className={`cl-drop${dragOn ? " on" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOn(true); }}
          onDragLeave={() => setDragOn(false)}
          onDrop={(e) => { e.preventDefault(); setDragOn(false); addFiles(e.dataTransfer.files); }}
        >
          <input ref={inputRef} type="file" multiple accept=".eml,message/rfc822" onChange={(e) => e.target.files && addFiles(e.target.files)} />
          <b>{checking ? "Checking signatures…" : "Drop .eml files here"}</b>
          <span className="cl-soft">or choose files. Nothing is saved until you sign.</span>
        </label>
        <EmailHelp />
      </div>

      {rows && (
        <div className="card cl-step">
          <span className="k"><b>3</b>Review</span>
          <div className="cl-row" style={{ justifyContent: "space-between" }}>
            <h2>What we found</h2>
            <button className="cl-link" onClick={clearFiles}>Start over</button>
          </div>
          <ul className="cl-rows">
            {rows.map((r, i) => (
              <li key={`${r.file}-${i}`}>
                <time>{fmtDate(r.date) || "No date"}</time>
                <span className="p">{r.project || r.file}</span>
                <span className="fee">{r.ok && r.kind === "receipt" && r.feeCents !== undefined ? formatCents(r.feeCents) : rowChip(r)}</span>
                <span className="why">
                  {r.ok && r.kind === "receipt" ? rowChip(r) : r.message}
                  {r.showHelp && <> (see &ldquo;How do I get the .eml file?&rdquo; above)</>}
                </span>
              </li>
            ))}
          </ul>
          {summary && summary.claimable > 0 && (
            <div className="cl-sum">
              <div className="mini">
                <div className="r"><span>Self-backed fees</span><span>{formatCents(summary.selfBackedCents)}</span></div>
                <div className="r"><span>Other fees</span><span>{formatCents(summary.otherCents)}</span></div>
                <div className="r total"><span>Total to claim</span><span>{formatCents(summary.totalCents)}</span></div>
              </div>
            </div>
          )}
        </div>
      )}

      {rows && summary && summary.claimable > 0 && (
        <div className="card cl-step">
          <span className="k"><b>4</b>Name</span>
          <fieldset className="cl-choice">
            <legend>How should you show in the public line?</legend>
            {([["initials", "Initials"], ["full", "Full name"], ["project", "Project only"]] as const).map(([v, l]) => (
              <label key={v}>
                <input type="radio" name="display" value={v} checked={mode === v} onChange={() => setMode(v)} />
                {l}
              </label>
            ))}
          </fieldset>
          {needsName && (
            <>
              <input className="cl-input" placeholder="Your name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
              {name.trim() && <span className="cl-preview">Shown as: {mode === "full" ? name.trim() : initialsOf(name)}</span>}
            </>
          )}
          {mode === "project" && <span className="cl-preview">Shown as: {[...new Set(claimable.map((r) => r.project))].join(", ")}</span>}
        </div>
      )}

      {rows && summary && summary.claimable > 0 && (
        <div className="card cl-step">
          <span className="k"><b>5</b>Sign</span>
          <h2>Sign and send</h2>
          <p className="cl-soft">Your wallet signs a message with your receipts and payout address. No fee, no transaction.</p>
          <label className="cl-confirm">
            <input type="checkbox" checked={noChargeback} onChange={(e) => setNoChargeback(e.target.checked)} required />
            I haven&apos;t reversed or charged back this payment.
          </label>
          <label className="cl-confirm">
            <input type="checkbox" checked={notRestricted} onChange={(e) => setNotRestricted(e.target.checked)} required />
            I am not located in, or acting for anyone in, Cuba, Iran, North Korea, Syria, Russia, or the Crimea, Donetsk or Luhansk regions.
          </label>
          {error && <p className="cl-error">{error}</p>}
          <div className="cl-row">
            <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
              {sending ? "Waiting for your wallet…" : `Claim ${formatCents(summary.totalCents)}`}
              <span className="arr"><Icon name="arrow" /></span>
            </button>
            {!isConnected && <span className="cl-soft">Connect a wallet first.</span>}
            {isConnected && needsName && !name.trim() && <span className="cl-soft">Add a name, or choose project only.</span>}
            {isConnected && (!needsName || name.trim()) && !(noChargeback && notRestricted) && <span className="cl-soft">Tick both boxes above to sign.</span>}
          </div>
        </div>
      )}
      {error && !(rows && summary && summary.claimable > 0) && <p className="cl-error">{error}</p>}
    </div>
  );
}
