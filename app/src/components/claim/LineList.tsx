"use client";

import { useCallback, useEffect, useState } from "react";
import { BASESCAN_TX } from "@/lib/base";
import { formatCents, formatCentsExact, statusText, type LineEntry } from "@/lib/claims";
import { isMine, useMyHolds } from "./holds";
import { OutsidePay } from "./OutsidePay";

export type LineState = { line: LineEntry[]; loaded: boolean; offline: boolean; reload: () => void };

export function useLine(): LineState {
  const [line, setLine] = useState<LineEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const reload = useCallback(() => {
    fetch("/api/line", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        setOffline(!r.ok);
        setLine(Array.isArray(j.line) ? j.line : []);
      })
      .catch(() => setOffline(true))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(reload, [reload]);
  return { line, loaded, offline, reload };
}

const GROUP_LABEL: Record<1 | 2, string> = { 1: "Self-backed", 2: "Backed others" }; // TODO(copy)

function statusChip(e: LineEntry) {
  const cls = e.status === "paid" ? "cl-ok" : e.status === "partial" ? "cl-wait" : "cl-no";
  return <span className={`chip ${cls}`}>{statusText(e)}</span>;
}

/** A paid row that came in a little short (up to 0.9% of the fee, the card or exchange fee) still counts as paid. */
function ForgivenNote({ e }: { e: LineEntry }) {
  const forgiven = e.forgivenCents ?? 0;
  if (e.status !== "paid" || forgiven <= 0) return null;
  return (
    <small className="cl-forgiven">
      Paid {formatCentsExact(e.feeCents - forgiven)} of {formatCentsExact(e.feeCents)}. Counted as paid: within the 0.9% fee allowance.
    </small>
  );
}

/** The onchain record of this row, once it is written. Nothing while it is pending. */
export const EAS_VIEW = "https://base.easscan.org/attestation/view/";

function RecordLink({ e }: { e: LineEntry }) {
  if (e.recordState !== "recorded" || !e.recordUid) return null;
  return (
    <a className="cl-rec" href={EAS_VIEW + e.recordUid} target="_blank" rel="noreferrer">
      Recorded on Base
    </a>
  );
}

/** "14:05" in the viewer's own clock. */
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Someone else holds this person right now (not this browser), so Pay waits and Help pay skips them. */
export const heldByOther = (e: LineEntry, now: number) => !!e.held && !!e.heldUntil && Date.parse(e.heldUntil) > now && !isMine(e.pid);

/** Now, ticking every 15 seconds while any hold is showing, so an expired hold drops off the row. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function LineList({
  entries,
  loaded,
  renderAction,
}: {
  entries: LineEntry[];
  loaded: boolean;
  renderAction?: (e: LineEntry) => React.ReactNode;
}) {
  useMyHolds();
  const now = useNow(entries.some((e) => e.held));
  if (!loaded) return <p className="cl-empty">Loading the line…</p>;
  if (!entries.length) return <p className="cl-empty">No one in line yet. Claims are checked as they come in.</p>;
  // "I'm paying this outside Pledger" shows on the first open row only (the next person to pay), not on every row.
  const outsideRow = entries.find((e) => e.status !== "paid" && !heldByOther(e, now));
  return (
    <ol className="cl-line">
      {entries.map((e) => (
        <li key={`${e.pid}-${e.group}`}>
          <div className="cl-entry">
            <span className="n">{e.place}</span>
            <span className="who">
              <b>{e.label}</b>
              <small>{GROUP_LABEL[e.group]} · {e.projects.join(", ")} · {e.shortAddress}</small>
            </span>
            <span className="amt">
              <b>{formatCents(e.feeCents)}</b>
              {statusChip(e)}
              <ForgivenNote e={e} />
              <RecordLink e={e} />
            </span>
            {renderAction && (
              <span className="act">
                {renderAction(e)}
                {heldByOther(e, now) && <span className="cl-held cl-held-act">Someone is paying this person now · until {clock(e.heldUntil!)}</span>}
              </span>
            )}
          </div>
          <RowMore e={e} now={now} hasPay={!!renderAction} showOutside={e === outsideRow} />
        </li>
      ))}
    </ol>
  );
}

/** Under a row: a hold by someone else (beside the Pay button instead, where there is one), extras received,
 * and the outside-Pledger button on the first open row. */
function RowMore({ e, now, hasPay, showOutside }: { e: LineEntry; now: number; hasPay: boolean; showOutside: boolean }) {
  const held = heldByOther(e, now);
  const showHeld = held && !hasPay;
  const outside = showOutside && e.status !== "paid" && !held;
  if (!showHeld && !e.extras?.length && !outside) return null;
  return (
    <div className="cl-rowmore">
      {showHeld && (
        <span className="cl-held">Someone is paying this person now · until {clock(e.heldUntil!)}</span>
      )}
      {e.extras?.map((x) => (
        <span key={x.txHash}>
          Also received {formatCentsExact(x.cents)}. It did not match what was owed.{" "}
          <a href={BASESCAN_TX + x.txHash} target="_blank" rel="noreferrer">View on Basescan</a>
        </span>
      ))}
      {outside && <OutsidePay pid={e.pid} hasPay={hasPay} />}
    </div>
  );
}
