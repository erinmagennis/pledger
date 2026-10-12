"use client";

import { useState } from "react";
import { HelpPay } from "./HelpPay";
import { LineList, useLine } from "./LineList";
import { PayPanel } from "./PayPanel";

export function LineWithPay() {
  const { line, loaded, offline, reload } = useLine();
  const [version, setVersion] = useState(0);
  const refresh = () => {
    reload();
    setVersion((v) => v + 1);
  };
  return (
    <div className="pcol">
      <HelpPay lineVersion={version} onPaid={refresh} />
      <div className="card">
        <span className="k"><span className="live" />Live</span>
        <h2 style={{ marginTop: 8 }}>Everyone in line</h2>
        <p className="cl-soft" style={{ marginTop: 6 }}>
          Or pay one person: press Pay to send USDC on Base straight to them. Pledger checks the payment and updates the line.
        </p>
        {offline && loaded && !line.length ? <p className="cl-empty">The line is not live yet.</p> : (
          <LineList entries={line} loaded={loaded} renderAction={(e) => <PayPanel entry={e} onPaid={refresh} />} />
        )}
      </div>
    </div>
  );
}
