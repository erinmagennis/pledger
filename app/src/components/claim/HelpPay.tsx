"use client";

// "Help pay people back": pick an amount or a number of people; the server splits it across the line
// in order, then the helper sends USDC on Base straight to each person (one batch when the wallet allows).
import { useEffect, useState } from "react";
import { encodeFunctionData, type Hex } from "viem";
import { useCapabilities, useConfig, useConnection, useConnect, useConnectors, usePublicClient, useSendCalls, useSwitchChain, useWriteContract } from "wagmi";
import { waitForCallsStatus } from "wagmi/actions";
import { base } from "wagmi/chains";
import { Icon } from "@/components/Icons";
import { BASE_USDC, BASESCAN_TX, USDC_ABI } from "@/lib/base";
import { formatCents } from "@/lib/claims";

type PreviewTransfer = { address: string; shortAddress: string; label: string; places: number[]; amountUnits: string; amountCents: number };
type Preview = { transfers: PreviewTransfer[]; totalCents: number; leftoverCents: number };

const AMOUNTS = [25, 50, 100] as const;
const PEOPLE = [1, 3, 5] as const;

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

/** Record one person's share of a tx. Already recorded counts as done. */
async function record(address: string, txHash: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch("/api/payments/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimAddress: address, txHash }),
  });
  if (res.ok) return { ok: true };
  const j = await res.json().catch(() => ({}));
  if (res.status === 409 && /already recorded/i.test(j.error ?? "")) return { ok: true };
  return { ok: false, error: j.error || "Could not check that payment" };
}

function shortErr(e: unknown, fallback: string) {
  const m = e instanceof Error ? e.message : fallback;
  return /reject|denied|cancel/i.test(m) ? "Cancelled in your wallet" : m.split("\n")[0]!;
}

/** True when the wallet does not speak EIP-5792 at all, so one-by-one is the way. */
function unsupported(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: number; cause?: { code?: number } })?.code ?? (e as { cause?: { code?: number } })?.cause?.code;
  return code === 4200 || code === -32601 || /not supported|unsupported|does not exist|not implemented|unknown method/i.test(m);
}

export function HelpPay({ lineVersion, onPaid }: { lineVersion: number; onPaid: () => void }) {
  const [mode, setMode] = useState<"amount" | "people">("amount");
  const [amount, setAmount] = useState<number | "custom">(50);
  const [custom, setCustom] = useState("");
  const [n, setN] = useState<number>(3);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hashes, setHashes] = useState<string[]>([]);

  const config = useConfig();
  const { isConnected, chainId } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const switchChain = useSwitchChain();
  const write = useWriteContract();
  const sendCalls = useSendCalls();
  const client = usePublicClient({ chainId: base.id });
  const caps = useCapabilities({ chainId: base.id, query: { enabled: isConnected, retry: false } });
  const canBatch = isConnected && caps.isSuccess && !!caps.data;

  const customUsd = Number(custom);
  const request: { amountUsd: number } | { nextN: number } | null =
    mode === "people" ? { nextN: n } : amount === "custom" ? (customUsd > 0 ? { amountUsd: customUsd } : null) : { amountUsd: amount };
  const key = JSON.stringify(request);

  useEffect(() => {
    if (!request) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setPreviewErr(null);
      try {
        const res = await fetch("/api/line/allocate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: key,
          signal: ctl.signal,
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "Could not load the line");
        setPreview(j as Preview);
      } catch (e) {
        if (ctl.signal.aborted) return;
        setPreview(null);
        setPreviewErr(e instanceof Error ? e.message : "Could not load the line");
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, amount === "custom" && mode === "amount" ? 350 : 0);
    return () => {
      ctl.abort();
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, lineVersion]);

  const transfers = preview?.transfers ?? [];
  const count = transfers.length;

  async function recordAll(list: PreviewTransfer[], txs: string[]): Promise<string[]> {
    const failed: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i]!;
      // Prefer the matching receipt when the wallet sent one tx per call, then try the rest.
      const order = txs.length === list.length ? [txs[i]!, ...txs.filter((_, j) => j !== i)] : txs;
      let last = "Could not check that payment";
      let ok = false;
      for (const h of order) {
        const r = await record(t.address, h);
        if (r.ok) {
          ok = true;
          break;
        }
        last = r.error;
        if (/003 update/.test(r.error)) break;
      }
      if (!ok) failed.push(`${t.label || t.shortAddress}: ${last}`);
    }
    return failed;
  }

  async function sendBatch(list: PreviewTransfer[]): Promise<string[]> {
    setProgress(`Confirm ${people(list.length)} in your wallet`);
    const { id } = await sendCalls.mutateAsync({
      chainId: base.id,
      calls: list.map((t) => ({
        to: BASE_USDC,
        data: encodeFunctionData({ abi: USDC_ABI, functionName: "transfer", args: [t.address as Hex, BigInt(t.amountUnits)] }),
      })),
    });
    setProgress("Sent. Waiting for Base to confirm…");
    const status = await waitForCallsStatus(config, { id, timeout: 180_000 });
    const txs = [...new Set((status.receipts ?? []).map((r) => r.transactionHash))];
    setHashes(txs);
    if (status.status !== "success" || !txs.length) throw new Error("The batch did not go through on Base");
    return txs;
  }

  async function sendOneByOne(list: PreviewTransfer[]): Promise<{ txs: string[]; sent: PreviewTransfer[] }> {
    const txs: string[] = [];
    const sent: PreviewTransfer[] = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i]!;
      setProgress(list.length > 1 ? `${i} of ${list.length} sent. Confirm the next one in your wallet` : "Confirm in your wallet");
      try {
        const h = await write.mutateAsync({
          address: BASE_USDC,
          abi: USDC_ABI,
          functionName: "transfer",
          args: [t.address as Hex, BigInt(t.amountUnits)],
          chainId: base.id,
        });
        if (client) await client.waitForTransactionReceipt({ hash: h });
        txs.push(h);
        sent.push(t);
        setHashes([...txs]);
        setProgress(`${i + 1} of ${list.length} sent`);
        const r = await record(t.address, h);
        if (!r.ok) setErr(`${t.label || t.shortAddress}: ${r.error}`);
      } catch (e) {
        if (!sent.length) throw e;
        setErr(`${shortErr(e, "Payment failed")}. ${sent.length} of ${list.length} sent before that.`);
        break;
      }
    }
    return { txs, sent };
  }

  async function send() {
    if (!count || !preview) return;
    const list = transfers;
    setBusy(true);
    setErr(null);
    setDone(null);
    setHashes([]);
    try {
      if (chainId !== base.id) await switchChain.mutateAsync({ chainId: base.id });
      let failed: string[] = [];
      let sentCount = list.length;
      let batched = false;
      if (canBatch && list.length > 1) {
        try {
          const txs = await sendBatch(list);
          batched = true;
          setProgress("Checking each payment…");
          failed = await recordAll(list, txs);
        } catch (e) {
          if (!unsupported(e)) throw e;
        }
      }
      if (!batched) {
        const r = await sendOneByOne(list);
        sentCount = r.sent.length;
      }
      setProgress(null);
      if (failed.length) setErr(failed.join(" · "));
      if (sentCount) setDone(`Sent to ${people(sentCount)}. Thank you.`);
      onPaid();
    } catch (e) {
      setProgress(null);
      setErr(shortErr(e, "Payment failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card cl-help-card" id="help">
      <h2>Help pay people back</h2>
      <p className="cl-soft" style={{ marginTop: 6 }}>
        Pick an amount or how many people. It goes to the next people in line, in order, straight to their wallets.
      </p>

      <fieldset className="cl-choice cl-seg">
        <legend className="sr-only">How you want to help</legend>
        <label><input type="radio" name="help-mode" checked={mode === "amount"} onChange={() => setMode("amount")} />An amount</label>
        <label><input type="radio" name="help-mode" checked={mode === "people"} onChange={() => setMode("people")} />The next people</label>
      </fieldset>

      {mode === "amount" ? (
        <fieldset className="cl-choice cl-opts">
          <legend className="sr-only">Amount</legend>
          {AMOUNTS.map((a) => (
            <label key={a}><input type="radio" name="help-amount" checked={amount === a} onChange={() => setAmount(a)} />${a}</label>
          ))}
          <label><input type="radio" name="help-amount" checked={amount === "custom"} onChange={() => setAmount("custom")} />Other</label>
          {amount === "custom" && (
            <span className="cl-usd">
              <span aria-hidden>$</span>
              <input
                className="cl-input"
                inputMode="decimal"
                aria-label="Amount in US dollars"
                placeholder="20"
                value={custom}
                autoFocus
                onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ""))}
              />
            </span>
          )}
        </fieldset>
      ) : (
        <fieldset className="cl-choice cl-opts">
          <legend className="sr-only">How many people</legend>
          {PEOPLE.map((p) => (
            <label key={p}><input type="radio" name="help-people" checked={n === p} onChange={() => setN(p)} />{p}</label>
          ))}
        </fieldset>
      )}

      <div className="cl-alloc" aria-live="polite">
        {!request ? (
          <p className="cl-soft">Enter an amount to see who it goes to.</p>
        ) : previewErr ? (
          <p className="cl-soft">{previewErr}</p>
        ) : !preview ? (
          <p className="cl-soft">Working out who is next…</p>
        ) : !count ? (
          <p className="cl-soft">Everyone in line is paid right now.</p>
        ) : (
          <>
            <ul className={`cl-alloc-list${loading ? " dim" : ""}`}>
              {transfers.map((t) => (
                <li key={t.address}>
                  <span className="n">{t.places[0]}</span>
                  <span className="who"><b>{t.label || t.shortAddress}</b><small>{t.shortAddress}</small></span>
                  <b className="amt">{formatCents(t.amountCents)}</b>
                </li>
              ))}
            </ul>
            {preview.leftoverCents > 0 && (
              <p className="cl-soft">The line only needs {formatCents(preview.totalCents)} right now, so that is all you send.</p>
            )}
            <details className="cl-help">
              <summary>Full addresses</summary>
              <ul className="cl-fulladdr">
                {transfers.map((t) => (
                  <li key={t.address}><span>{t.label || "Person"} · {formatCents(t.amountCents)}</span><span className="cl-addr">{t.address}</span></li>
                ))}
              </ul>
              <p style={{ marginTop: 10 }}>Check these in your wallet before you confirm.</p>
            </details>
          </>
        )}
      </div>

      {!isConnected ? (
        <div className="cl-row" style={{ marginTop: 16 }}>
          {connectors.map((c) => (
            <button key={c.uid} className="btn btn-ghost" onClick={() => connect.mutate({ connector: c, chainId: base.id })}>
              {c.id === "injected" ? "Browser wallet" : c.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="cl-row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy || loading || !count} onClick={send}>
            {busy ? "Working…" : count ? `Send ${formatCents(preview!.totalCents)} to ${people(count)}` : "Send"}
            <span className="arr"><Icon name="arrow" /></span>
          </button>
          {count > 1 && <span className="cl-soft">{canBatch ? "One confirm in your wallet." : `${count} confirms in your wallet, one per person.`}</span>}
        </div>
      )}
      {!isConnected && count > 0 && (
        <p className="cl-soft" style={{ marginTop: 10 }}>Connect a wallet on Base to send {formatCents(preview!.totalCents)} to {people(count)}.</p>
      )}

      <div className="cl-status">
        {progress && <span>{progress}</span>}
        {done && <span>{done}</span>}
        {err && <span className="cl-error">{err}</span>}
        {hashes.map((h) => (
          <a key={h} className="cl-soft" href={BASESCAN_TX + h} target="_blank" rel="noreferrer">View on Basescan</a>
        ))}
      </div>
    </div>
  );
}
