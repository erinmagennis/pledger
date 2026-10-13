import type { Metadata } from "next";
import { Button } from "@/components/Button";
import { Kinds } from "@/components/home/Kinds";
import { MakeForm } from "@/components/selfserve/MakeForm";
import "@/styles/selfserve.css";

export const metadata: Metadata = { title: "Make a pledge · Pledger" };

// Same width as every other page: the layout's .wrap sets it, so no wrap of our own here.
export default function MakePage() {
  return (
    <main>
      <section className="hero ss-make">
        <div className="ss-make-copy">
          <h1>Make a <em>match</em>.</h1>
          <p className="sub">
            Set the rule once. The pool matches each gift and sends both together. Try it now with test money.
          </p>
          <ul className="ss-points">
            <li>Locked until the date you pick</li>
            <li>Every gift and match public on Tempo</li>
            <li>Your own page to share</li>
          </ul>
        </div>
        <MakeForm />
      </section>
      <section className="ss-funder">
        <div>
          <h2>Pledging real money?</h2>
          <p>For now we set up each real pledge with you. You set the rule once. Pledger checks claims, keeps the public line and records every payment.</p>
        </div>
        <div className="ctas">
          <Button href="https://t.me/erinmagennis">Talk to us on Telegram</Button>
          <Button href="/pledges/test-match-pool" variant="ghost">See an example</Button>
        </div>
      </section>
      <section>
        <Kinds matched={null} />
      </section>
    </main>
  );
}
