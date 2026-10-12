import type { Metadata } from "next";
import { Button } from "@/components/Button";
import { Kinds } from "@/components/home/Kinds";

export const metadata: Metadata = { title: "Make a pledge · Pledger" };

// Same width as every other page: the layout's .wrap sets it, so no wrap of our own here.
export default function MakePage() {
  return (
    <main>
      <section className="hero" style={{ gridTemplateColumns: "1fr" }}>
        <div>
          <h1>Make a <em>pledge</em>.</h1>
          <p className="sub" style={{ maxWidth: "40ch" }}>
            You set the rule once. Pledger checks claims, keeps the public line and records every payment.
            For now we set up each pledge with you.
          </p>
          <div className="ctas">
            <Button href="https://t.me/erinmagennis">Talk to us on Telegram</Button>
            <Button href="/pledges/test-match-pool" variant="ghost">See a match work</Button>
          </div>
        </div>
      </section>
      <section>
        <Kinds matched={null} />
      </section>
    </main>
  );
}
