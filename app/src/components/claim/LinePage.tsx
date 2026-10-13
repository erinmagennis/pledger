"use client";

import "./claim.css";
import { useState } from "react";
import { formatCents } from "@/lib/claims";
import { lineStats, type LineStats } from "@/lib/pledges";
import { HelpPay } from "./HelpPay";
import { LineList, useLine } from "./LineList";
import { PayPanel } from "./PayPanel";

/** The full line with paying. `initial` is the server's count, shown until the live line loads. */
export function LineWithPay({ initial }: { initial?: LineStats }) {
  const { line, loaded, offline, reload } = useLine();
  const st = loaded ? lineStats(line) : initial ?? { people: 0, feesCents: 0, paidCents: 0 };
  const [version, setVersion] = useState(0);
  // A person can hold two places; Pay sends everything they still owe.
  const owedBy = (pid: string) => line.filter((e) => e.pid === pid).reduce((s, e) => s + Math.max(0, e.feeCents - e.paidCents), 0);
  const refresh = () => {
    reload();
    setVersion((v) => v + 1);
  };
  return (
    <div className="pcol">
      <HelpPay lineVersion={version} onPaid={refresh} />
      <div className="card linecard">
        <div className="lc-top">
          <h2 className="gb-h" id="gb-line">The line <span className="k lc-live"><span className="live" />Live</span></h2>
          <dl className="lc-stats">
            <div><dt>in line</dt><dd>{st.people}</dd></div>
            <div><dt>fees claimed</dt><dd>{formatCents(st.feesCents)}</dd></div>
            <div><dt>paid so far</dt><dd>{formatCents(st.paidCents)}</dd></div>
          </dl>
        </div>
        <p className="cl-soft" style={{ marginTop: 6 }}>
          Press Pay to send USDC on Base straight to one person. Pledger checks the payment and updates the line.
        </p>
        {offline && loaded && !line.length ? <p className="cl-empty">The line is not live yet.</p> : (
          <LineList entries={line} loaded={loaded} renderAction={(e) => <PayPanel entry={e} owedCents={owedBy(e.pid)} onPaid={refresh} />} />
        )}
      </div>
    </div>
  );
}
