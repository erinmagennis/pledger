"use client";

import { useState } from "react";

/** What really happens, in order. `detail` is the technical version, behind a small toggle. */
const STEPS = [
  {
    text: "The funder sets the rule and puts the money in place.",
    detail:
      "In the demo, a smart contract on Tempo holds the match until 31 December. The funder can only take back what is left, and only after that date.",
  },
  {
    text: "People claim or give, and Pledger checks each one.",
    detail:
      "A give-back claim starts with the receipt email. Pledger checks its DKIM signature from artizen.fund, so an edited or made-up email fails, and each receipt can be claimed once.",
  },
  {
    text: "Payments land and are recorded in public.",
    detail:
      "Give-backs are paid in USDC on Base, and Pledger reads each payment from the chain before it counts. Paid claims get a public record on Base through EAS. In the demo, the gift and its match reach the project together, in one Tempo transaction.",
  },
];

function Step({ n, text, detail }: { n: number; text: string; detail: string }) {
  const [open, setOpen] = useState(false);
  const id = `how-detail-${n}`;
  return (
    <div className="step">
      <span className="n">{n}</span>
      <p>{text}</p>
      <button type="button" className="step-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide the technical detail" : "How it works technically"}
        <span className="chev" aria-hidden="true" />
      </button>
      <p className="step-detail" id={id} hidden={!open}>{detail}</p>
    </div>
  );
}

export function Band() {
  return (
    <section className="band" id="how">
      <h2><span>You make the promise.</span><em>We do the admin.</em></h2>
      <div className="steps">
        {STEPS.map((s, i) => <Step key={i} n={i + 1} text={s.text} detail={s.detail} />)}
      </div>
    </section>
  );
}
