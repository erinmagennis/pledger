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

/** "14:05" in the viewer's own clock. */
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
            </span>
            {renderAction && <span className="act">{renderAction(e)}</span>}
          </div>
          <RowMore e={e} now={now} hasPay={!!renderAction} />
        </li>
      ))}
    </ol>
  );
}

/** Under a row: a hold by someone else, extras received, and the outside-Pledger button. */
function RowMore({ e, now, hasPay }: { e: LineEntry; now: number; hasPay: boolean }) {
  const heldByOther = !!e.held && !!e.heldUntil && Date.parse(e.heldUntil) > now && !isMine(e.pid);
  const open = e.status !== "paid";
  if (!heldByOther && !e.extras?.length && !open) return null;
  return (
    <div className="cl-rowmore">
      {heldByOther && (
        <span className="cl-held">Someone is paying this person now · until {clock(e.heldUntil!)}</span>
      )}
      {e.extras?.map((x) => (
        <span key={x.txHash}>
          Also received {formatCentsExact(x.cents)}, over what was owed ·{" "}
          <a href={BASESCAN_TX + x.txHash} target="_blank" rel="noreferrer">View on Basescan</a>
        </span>
      ))}
      {open && !heldByOther && <OutsidePay pid={e.pid} hasPay={hasPay} />}
    </div>
  );
}
