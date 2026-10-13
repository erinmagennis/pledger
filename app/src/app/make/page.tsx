import type { Metadata } from "next";
import { Button } from "@/components/Button";
import { MakeForm } from "@/components/selfserve/MakeForm";
import "@/styles/selfserve.css";

export const metadata: Metadata = { title: "Make a pledge · Pledger" };

// Same width as every other page: the layout's .wrap sets it, so no wrap of our own here.
// Short intro on top, then the form as the main, full-width element.
export default function MakePage() {
  return (
    <main>
      <section className="ss-make-head">
        <h1>Make a <em>pledge</em>.</h1>
        <p className="sub">Pick the kind of pledge, set the rule once, and get your own page to share. Matches run now with test money.</p>
        <ul className="ss-points">
          <li>Locked until the date you pick</li>
          <li>Every gift and match public on Tempo</li>
          <li>Your own page to share</li>
        </ul>
      </section>
      <section className="ss-make-main">
        <MakeForm />
      </section>
      <section className="ss-funder">
        <div>
          <h2>Pledging real money?</h2>
          <p>For now we set up each real pledge with you. You set the rule once. Pledger checks claims, keeps the public line and records every payment.</p>
        </div>
        <div className="ctas">
          <Button href="https://t.me/erinmagennis">Talk to us on Telegram</Button>
          <Button href="/pledges/demo" variant="ghost">See an example</Button>
        </div>
      </section>
    </main>
  );
}
