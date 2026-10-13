"use client";

import "./claim.css";
import { useState, type ReactNode } from "react";
import { formatCents } from "@/lib/claims";
import { lineStats, type LineStats } from "@/lib/pledges";
import { HelpPay } from "./HelpPay";
import { LineList, useLine } from "./LineList";
import { PayPanel } from "./PayPanel";

/** The full line with paying. `initial` is the server's count, shown until the live line loads. */
export function LineWithPay({ initial, funder }: { initial?: LineStats; funder?: ReactNode }) {
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
      <section className="gb-sec" aria-labelledby="gb-backers">
        <h2 id="gb-backers" className="gb-h">Who&apos;s backing it</h2>
        <div className="gb4-split">
          {funder}
          <div className="card gb4-backit">
            <h3>Back it too</h3>
            <ol className="gb4-steps">
              <li>Pick an amount, or how many people to pay.</li>
              <li>Pay with USDC on Base from your wallet.</li>
              <li>It goes straight to the next people in line, in order.</li>
            </ol>
            <HelpPay lineVersion={version} onPaid={refresh} />
          </div>
        </div>
      </section>
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
