"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCents, statusText, type LineEntry } from "@/lib/claims";

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

export function LineList({
  entries,
  loaded,
  renderAction,
}: {
  entries: LineEntry[];
  loaded: boolean;
  renderAction?: (e: LineEntry) => React.ReactNode;
}) {
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
        </li>
      ))}
    </ol>
  );
}
