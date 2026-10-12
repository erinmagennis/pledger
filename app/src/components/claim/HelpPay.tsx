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
import { hold, myHeldPids } from "./holds";

type PreviewTransfer = { pid: string; address: string; shortAddress: string; label: string; places: number[]; amountUnits: string; amountCents: number };
type Preview = { transfers: PreviewTransfer[]; totalCents: number; leftoverCents: number; nextCents: number; heldCount?: number };
/** A transfer that was sent, with the tx hashes to check it against (best match first). */
type Sent = { t: PreviewTransfer; txs: string[] };

const LINE_CHANGED = "The line changed, check it again";
const sameTransfers = (a: PreviewTransfer[], b: PreviewTransfer[]) =>
  a.length === b.length && a.every((t, i) => t.address === b[i]!.address && t.amountUnits === b[i]!.amountUnits);

const AMOUNTS = [25, 50, 100] as const;
const PEOPLE = [1, 3, 5] as const;

/** The split request, with the people this helper already holds so their own hold does not hide them. */
const allocBody = (key: string) => JSON.stringify({ ...JSON.parse(key), mine: myHeldPids() });

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

/** A failure worth checking again later: not on Base yet, or the server had trouble. Anything else is the rule saying no. */
const retryable = (status: number, error: string) => status >= 500 || /not found/i.test(error);

/** Record one person's share of a tx. Already recorded counts as done. `note` is set when it was stored as an extra. */
async function record(address: string, txHash: string): Promise<{ ok: true; note?: string } | { ok: false; error: string; final: boolean }> {
  const res = await fetch("/api/payments/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimAddress: address, txHash }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.ok) return j.kind === "extra" && j.message ? { ok: true, note: String(j.message) } : { ok: true };
  if (res.status === 409 && /already recorded/i.test(j.error ?? "")) return { ok: true };
  const error = j.error || "Could not check that payment";
  return { ok: false, error, final: !retryable(res.status, error) };
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
  const [notes, setNotes] = useState<string[]>([]);
  const [hashes, setHashes] = useState<string[]>([]);
  // Sent but not yet recorded. While this holds anything, the button checks again instead of sending.
  const [pending, setPending] = useState<Sent[]>([]);
  const [callsId, setCallsId] = useState<{ id: string; list: PreviewTransfer[] } | null>(null);

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
          body: allocBody(key),
          signal: ctl.signal,
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "Could not load the line");
        setPreview(j as Preview);
        // Hold these people while this helper decides, so a second helper is sent to the next people instead.
        void hold((j as Preview).transfers.map((t) => t.pid), "pledger");
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
  /** No one owes anything: hide the wallet buttons. */
  const lineEmpty = !!preview && !count && !preview.nextCents;
  /** A payment was sent and is not recorded yet. */
  const waiting = pending.length > 0 || !!callsId;

  /** Pair each transfer with the batch's hashes. Prefer the matching receipt when the wallet sent one tx per call. */
  const pairUp = (list: PreviewTransfer[], txs: string[]): Sent[] =>
    list.map((t, i) => ({ t, txs: txs.length === list.length ? [txs[i]!, ...txs.filter((_, j) => j !== i)] : txs }));

  /** Record each sent transfer. Returns the ones still worth checking again, with every error.
   * A transfer every hash of which got a final rule rejection is dropped, so Send comes back. */
  async function recordAll(items: Sent[]): Promise<{ left: Sent[]; failed: string[]; notes: string[] }> {
    const left: Sent[] = [];
    const failed: string[] = [];
    const notes: string[] = [];
    for (const item of items) {
      let last = "Could not check that payment";
      let ok = false;
      let final = true;
      for (const h of item.txs) {
        const r = await record(item.t.address, h);
        if (r.ok) {
          ok = true;
          if (r.note) notes.push(`${item.t.label || item.t.shortAddress}: ${r.note}`);
          break;
        }
        last = r.error;
        if (!r.final) final = false;
        if (/003 update/.test(r.error)) break;
      }
      if (!ok) {
        if (!final) left.push(item);
        failed.push(`${item.t.label || item.t.shortAddress}: ${last}`);
      }
    }
    return { left, failed, notes };
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
    // From here the money may be on its way, so never offer a second send for this batch.
    setCallsId({ id, list });
    return confirmBatch(id, list);
  }

  async function confirmBatch(id: string, list: PreviewTransfer[]): Promise<string[]> {
    setProgress("Sent. Waiting for Base to confirm…");
    const status = await waitForCallsStatus(config, { id, timeout: 180_000 });
    const txs = [...new Set((status.receipts ?? []).map((r) => r.transactionHash))];
    setHashes(txs);
    if (status.status !== "success" || !txs.length) {
      setCallsId(null); // failed on Base: nothing moved
      throw new Error("The batch did not go through on Base");
    }
    setCallsId(null);
    setPending(pairUp(list, txs));
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
        const item = { t, txs: [h] };
        setPending((p) => [...p, item]);
        txs.push(h);
        setHashes([...txs]);
        const receipt = client ? await client.waitForTransactionReceipt({ hash: h }) : null;
        if (receipt?.status !== "success") {
          if (receipt) setPending((p) => p.filter((x) => x !== item)); // reverted: nothing moved
          throw new Error(receipt ? "That payment failed on Base" : "Could not confirm on Base. Check again in a minute.");
        }
        sent.push(t);
        setProgress(`${i + 1} of ${list.length} sent`);
        const r = await record(t.address, h);
        if (r.ok || r.final) setPending((p) => p.filter((x) => x !== item));
        if (!r.ok) setErr(`${t.label || t.shortAddress}: ${r.error}`);
        else if (r.note) setNotes((n) => [...n, `${t.label || t.shortAddress}: ${r.note}`]);
      } catch (e) {
        if (!sent.length) throw e;
        setErr(`${shortErr(e, "Payment failed")}. ${sent.length} of ${list.length} sent before that.`);
        break;
      }
    }
    return { txs, sent };
  }

  /** Same split as the preview right now, or null when it moved. */
  async function stillSame(list: PreviewTransfer[]): Promise<boolean> {
    const res = await fetch("/api/line/allocate", { method: "POST", headers: { "content-type": "application/json" }, body: allocBody(key) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Could not load the line");
    setPreview(j as Preview);
    return sameTransfers(list, (j as Preview).transfers);
  }

  /** Re-check payments already sent, instead of sending again. */
  async function checkAgain() {
    setBusy(true);
    setErr(null);
    try {
      // A batch that timed out has no hashes yet: wait for Base first.
      const items = callsId ? pairUp(callsId.list, await confirmBatch(callsId.id, callsId.list)) : pending;
      setProgress("Checking each payment…");
      const r = await recordAll(items);
      setPending(r.left);
      setNotes(r.notes);
      setProgress(null);
      if (r.failed.length) setErr(r.failed.join(" · "));
      else setDone("Payments recorded. Thank you.");
      onPaid();
    } catch (e) {
      setProgress(null);
      setErr(shortErr(e, "Could not check that payment"));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!count || !preview || pending.length || callsId) return;
    const list = transfers;
    setBusy(true);
    setErr(null);
    setDone(null);
    setNotes([]);
    setHashes([]);
    try {
      if (chainId !== base.id) await switchChain.mutateAsync({ chainId: base.id });
      // Another helper may have paid some of these people since the preview loaded.
      if (!(await stillSame(list))) {
        setErr(LINE_CHANGED);
        onPaid();
        return;
      }
      // Refresh the hold as the payer signs, so it lasts while the wallet and Base confirm.
      await hold(list.map((t) => t.pid), "pledger");
      let failed: string[] = [];
      let sentCount = list.length;
      let batched = false;
      if (canBatch && list.length > 1) {
        try {
          const txs = await sendBatch(list);
          batched = true;
          setProgress("Checking each payment…");
          const r = await recordAll(pairUp(list, txs));
          setPending(r.left);
          setNotes(r.notes);
          failed = r.failed;
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
        ) : !count && preview.nextCents > 0 ? (
          <p className="cl-soft">Not enough for the next person ({formatCents(preview.nextCents)}).</p>
        ) : !count && preview.heldCount ? (
          <p className="cl-soft">Someone is paying the next people now. Check again in a few minutes.</p>
        ) : !count ? (
          <p className="cl-soft">No one is waiting yet.</p>
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
            {!!preview.heldCount && (
              <p className="cl-soft">
                Skipped {people(preview.heldCount)}: someone else is paying them right now.
              </p>
            )}
            {preview.leftoverCents > 0 && (
              <p className="cl-soft">
                {preview.nextCents > 0
                  ? `${formatCents(preview.leftoverCents)} left over, not enough for the next person (${formatCents(preview.nextCents)}).`
                  : `The line only needs ${formatCents(preview.totalCents)} right now, so that is all you send.`}
              </p>
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

      {lineEmpty && !waiting ? null : !isConnected ? (
        <div className="cl-row" style={{ marginTop: 16 }}>
          {connectors.map((c) => (
            <button key={c.uid} className="btn btn-ghost" onClick={() => connect.mutate({ connector: c, chainId: base.id })}>
              {c.id === "injected" ? "Browser wallet" : c.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="cl-row" style={{ marginTop: 16 }}>
          {waiting ? (
            <button className="btn btn-primary" disabled={busy} onClick={checkAgain}>
              {busy ? "Working…" : "Check again"}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy || loading || !count} onClick={send}>
              {busy ? "Working…" : count ? `Send ${formatCents(preview!.totalCents)} to ${people(count)}` : "Send"}
              <span className="arr"><Icon name="arrow" /></span>
            </button>
          )}
          {!waiting && count > 1 && <span className="cl-soft">{canBatch ? "One confirm in your wallet." : `${count} confirms in your wallet, one per person.`}</span>}
        </div>
      )}
      {!isConnected && count > 0 && (
        <p className="cl-soft" style={{ marginTop: 10 }}>Connect a wallet on Base to send {formatCents(preview!.totalCents)} to {people(count)}.</p>
      )}

      <div className="cl-status">
        {progress && <span>{progress}</span>}
        {done && <span>{done}</span>}
        {notes.map((n) => (
          <span key={n}>{n}</span>
        ))}
        {err && <span className="cl-error">{err}</span>}
        {hashes.map((h) => (
          <a key={h} className="cl-soft" href={BASESCAN_TX + h} target="_blank" rel="noreferrer">View on Basescan</a>
        ))}
      </div>
    </div>
  );
}
