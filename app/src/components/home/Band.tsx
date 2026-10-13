"use client";

import Link from "next/link";
import { useState } from "react";
import { ZCASH_SLUG } from "@/lib/pledges";
import { Icon } from "../Icons";

/** What really happens, in order. `detail` is the technical version, behind a small "How?" toggle. */
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
      "Give-backs are paid in USDC on Base, and Pledger reads each payment from the chain before it counts. Anyone paying people back can also pay by card through Stripe, in test mode for now. Paid claims get a public record on Base through EAS. In the demo, the gift and its match reach the project together, in one Tempo transaction.",
  },
];

function Step({ n, text, detail }: { n: number; text: string; detail: string }) {
  const [open, setOpen] = useState(false);
  const id = `how-detail-${n}`;
  return (
    <div className="step">
      <span className="n">{n}</span>
      <p>
        {text}{" "}
        <button type="button" className="step-how" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          How?<span className="chev" aria-hidden="true" />
        </button>
      </p>
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
      <p className="band-note">
        <span className="ico"><Icon name="lock" small /></span>
        <span>
          <b>Public money, private funder:</b> a funder can keep their name private while anyone checks the money.{" "}
          <Link href={`/pledges/${ZCASH_SLUG}`}>See the Zcash pledge <Icon name="arrow" small /></Link>
        </span>
      </p>
    </section>
  );
}
