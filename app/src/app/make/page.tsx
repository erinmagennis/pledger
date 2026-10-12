import type { Metadata } from "next";
import { Button } from "@/components/Button";

export const metadata: Metadata = { title: "Make a pledge · Pledger" };

const KINDS = [
  { t: "Matching funds", p: "Match donations as a company, a fund or a person. The match is locked before you announce it." },
  { t: "Prize payouts", p: "Hackathon and grant prizes, paid on a date the winners can see." },
  { t: "Give-backs", p: "Return fees or winnings to the people who paid them." },
];

export default function MakePage() {
  return (
    <main className="wrap" style={{ padding: "48px 28px 24px" }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 20, marginTop: 28 }}>
        {KINDS.map((k) => (
          <div key={k.t} className="card">
            <h2>{k.t}</h2>
            <p style={{ marginTop: 8, color: "var(--soft)" }}>{k.p}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
