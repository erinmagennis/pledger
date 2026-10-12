import { Button } from "../Button";
import { Icon, type IconName } from "../Icons";
import { ARTIZEN_RULE, moneyRows, type LineStats, type Pledge } from "@/lib/pledges";

export function InPlaceCard({ pledge }: { pledge: Pledge }) {
  return (
    <div className="card">
      <span className="k"><span className="live" />Checked on {pledge.chain}</span>
      <h2 style={{ marginTop: 8 }}>What&apos;s in place</h2>
      <div className="mini">
        {pledge.inPlace.map((r) => (
          <div className="r" key={r.label}>
            <span>{r.label}</span>
            {r.href ? (
              <a className="mini-link" href={r.href} target="_blank" rel="noreferrer">{r.value}</a>
            ) : (
              <span className={r.ok ? "ok" : undefined}>{r.value}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityCard({ pledge }: { pledge: Pledge }) {
  return (
    <div className="card">
      <h2>Activity</h2>
      <ol className="log">
        {pledge.activity.map((a, i) => (
          <li key={i}>
            <time>{a.date}</time>
            <span>{a.text}</span>
            {a.amount ? <b>{a.amount}</b> : <span />}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HowCard({ pledge }: { pledge: Pledge }) {
  return (
    <div className="card">
      <h2>How this pledge works</h2>
      <ol className="how">
        {pledge.howItWorks.map((h, i) => <li key={i}>{h}</li>)}
      </ol>
    </div>
  );
}

/** Shared section head for the give-back page: same title style and left edge for every section. */
export function SectionHead({ id, title }: { id: string; title: string }) {
  return <h2 id={id} className="gb-h">{title}</h2>;
}

/** The rule (set once) and the money in place (live), side by side. Artizen give-back page only. */
export function RuleCard({ stats }: { stats: LineStats }) {
  return (
    <section className="gb-sec gb-rule-sec" aria-label="The rule and money in place">
      <div className="card gb-rule">
        <div className="gb-rule-col">
          <span className="k">The rule</span>
          <div className="mini gb-rule-rows">
            {ARTIZEN_RULE.rows.map((r) => (
              <div className="r" key={r.label}>
                <span>{r.label}</span>
                <span>{r.value}</span>
              </div>
            ))}
          </div>
          <p className="gb-rule-set">{ARTIZEN_RULE.setOn}</p>
        </div>
        <div className="gb-rule-col">
          <span className="k"><span className="live" />Money in place</span>
          <div className="mini">
            {moneyRows(stats).map((r) => (
              <div className="r" key={r.label}>
                <span>{r.label}</span>
                <span>{r.value}</span>
              </div>
            ))}
          </div>
          <p className="gb-rule-p">
            Nothing is locked yet, because the prize has not been awarded. When a pledge is funded up front, it
            looks like this:
          </p>
          <div className="gb-rule-cta">
            <Button href="/pledges/test-match-pool" variant="ghost">See a locked pledge</Button>
            <span className="chip demo">Demo · test money</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Who's backing it: Erin's funder card with her note, and an open slot for anyone who wants to help. */
export function BackersSection() {
  return (
    <section className="gb-sec" aria-labelledby="gb-backers">
      <SectionHead id="gb-backers" title="Who's backing it" />
      <div className="gb-two">
        <article className="card gb-funder">
          <div className="gb-person">
            <span className="av tone-matching">EM</span>
            <b>Erin Magennis</b>
            <span className="chip gb-pledged">Pledged</span>
          </div>
          <p className="gb-amount">50% of my Colosseum winnings</p>
          <p className="gb-small">Pays out if I win. Payouts start within 14 days of the prize arriving.</p>
          {/* TODO(copy): placeholder note. Erin to replace with her own words. */}
          <div className="gb-note">
            <span className="gb-note-k">Why I&apos;m doing this</span>
            <p>
              I paid this fee on my own projects too. If I win at Colosseum, half of it goes to the
              people in this line. Self-backers go first, since they paid the fee on their own work.
            </p>
            <p className="gb-sig">Erin</p>
          </div>
        </article>
        <article className="gb-invite">
          <span className="ico"><Icon name="plus" /></span>
          <h3>Back it too</h3>
          <div className="gb-happened">
            <p className="gb-happened-k">What happened</p>
            <p>
              Artizen was a platform for backing creative, science and public goods projects. It promised
              match funding on every purchase and charged backers a 10% endowment fee. In October 2026 it
              abruptly shut down. There is no sign the promised match will be paid or the fees returned.
            </p>
            <p>Many creators backed their own projects and planned around that match. They lost both.</p>
            <a className="gb-happened-link" href="https://payout-progress-artizen.pages.dev/" target="_blank" rel="noopener noreferrer">
              See the community payout tracker
            </a>
          </div>
          <p>
            Send USDC (a US dollar stablecoin) on Base straight to the next people in line. Pledger checks each payment and updates
            the line. Pledger never holds the money.
          </p>
          <div className="gb-invite-cta">
            <Button href="/claim/line#help" variant="ghost">Help pay people back</Button>
          </div>
        </article>
      </div>
    </section>
  );
}

const STEPS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "mail",
    title: "Download your receipt email",
    text: "From your inbox, the original email Artizen sent. Pledger checks its signature, so no screenshots.",
  },
  { icon: "wallet", title: "Connect your wallet and sign", text: "Signing is free. Your wallet is where you get paid." },
  { icon: "list", title: "Join the line", text: "Each receipt counts once. You can check your place anytime." },
];

/** Claim your 10%: one card. Steps on the left, the claim button and what we keep on the right. */
export function ClaimSection() {
  return (
    <section className="gb-sec" aria-labelledby="gb-claim">
      <SectionHead id="gb-claim" title="Claim your 10%" />
      <div className="card gb-claim">
        <ol className="gb-steps">
          {STEPS.map((s, i) => (
            <li className="gb-step" key={s.title}>
              <span className="gb-n">{i + 1}</span>
              <span className="ico"><Icon name={s.icon} /></span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <aside className="gb-panel">
          <Button href="/claim">Check or add your claim</Button>
          <div className="gb-keep">
            <h3><Icon name="shield" small />What we keep</h3>
            <p>
              A fingerprint of each receipt, the project, date and fee, your wallet and how you want to be
              shown. Never your email or its contents.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

/** Proof: a slim, quiet strip at the bottom. Fact chips, then the dated entries, oldest first. */
export function ProofStrip({ pledge }: { pledge: Pledge }) {
  const facts = ["Pledge 50% of Colosseum winnings", "Season 7", pledge.chain, `Records public on ${pledge.chain}`];
  const dated = [...pledge.activity].reverse();
  return (
    <section className="gb-proof" aria-label="Proof">
      <ul className="gb-facts">
        {facts.map((f) => <li key={f}>{f}</li>)}
      </ul>
      <ol className="gb-dated">
        {dated.map((a, i) => (
          <li key={i}>
            <time>{a.date.replace(/ \d{4}$/, "")}</time> {a.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
