import { Button } from "../Button";
import { Icon, type IconName } from "../Icons";
import type { Pledge } from "@/lib/pledges";

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
          <p>
            Send USDC on Base straight to someone in line. Pledger checks each payment and updates the
            line. Pledger never holds the money.
          </p>
          <div className="gb-invite-cta">
            <Button href="/claim/line" variant="ghost">Help pay people back</Button>
          </div>
        </article>
      </div>
    </section>
  );
}

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "mail", title: "Send your receipt email", text: "Pledger checks Artizen's signature on it. No screenshots." },
  { icon: "list", title: "Join the line", text: "Each receipt counts once. Self-backers go first." },
  { icon: "coin", title: "Get paid on Base", text: "Every payment is checked and recorded in public." },
];

/** How it works: three step cards, then what we keep and the proof. Quieter than the sections above. */
export function HowItWorksSection({ pledge }: { pledge: Pledge }) {
  const facts = [
    { label: "Pledge", value: "50% of Colosseum winnings" },
    { label: "Who can claim", value: "People who paid the 10% fee" },
    { label: "Season", value: "7" },
    { label: "Chain", value: pledge.chain },
    { label: "Records", value: `Public on ${pledge.chain} via EAS` },
  ];
  return (
    <section className="gb-sec" aria-labelledby="gb-how">
      <SectionHead id="gb-how" title="How it works" />
      <ol className="gb-steps">
        {STEPS.map((s, i) => (
          <li className="gb-step" key={s.title}>
            <div className="gb-step-top">
              <span className="ico"><Icon name={s.icon} /></span>
              <span className="gb-n">{i + 1}</span>
            </div>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
      <div className="gb-two gb-quiet">
        <div className="gb-qcard">
          <span className="ico"><Icon name="shield" /></span>
          <h3>What we keep</h3>
          <p>
            A fingerprint of each receipt, the project, date and fee, your wallet and how you want to be
            shown. Never your email or its contents.
          </p>
        </div>
        <div className="gb-qcard">
          <h3>Proof</h3>
          <dl className="facts">
            {facts.map((f) => (
              <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>
            ))}
          </dl>
          <ol className="gb-tl">
            {pledge.activity.map((a, i) => (
              <li key={i}>
                <time>{a.date}</time>
                <span>{a.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
