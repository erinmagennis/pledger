import { Button } from "../Button";
import { Icon, type IconName } from "../Icons";
import { ARTIZEN_RULE, moneyRows, type LineStats, type Pledge } from "@/lib/pledges";

export function InPlaceCard({ pledge }: { pledge: Pledge }) {
  return (
    <div className="card">
      {pledge.checkedOn ? (
        // A one-time snapshot, not a live check: neutral dot and the snapshot date.
        <span className="k"><span className="live still" />Checked {pledge.checkedOn}</span>
      ) : (
        <span className="k"><span className="live" />Checked on {pledge.chain}</span>
      )}
      <h2 style={{ marginTop: 8 }}>What&apos;s in place</h2>
      <div className="mini">
        {pledge.inPlace.map((r) => (
          <div className={r.note ? "r has-note" : "r"} key={r.label}>
            <span>{r.label}</span>
            {r.href ? (
              <a className="mini-link" href={r.href} target="_blank" rel="noreferrer">{r.value}</a>
            ) : (
              <span className={r.ok ? "ok" : undefined}>{r.value}</span>
            )}
            {r.note && <small className="mini-note">{r.note}</small>}
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
            {a.href ? (
              <a className="log-link" href={a.href} target="_blank" rel="noreferrer">{a.text}</a>
            ) : (
              <span>{a.text}</span>
            )}
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

/** Rule tiles: how wide each one is on the 4-column grid, so the rows end level. Same order as ARTIZEN_RULE.rows. */
const RULE_SPAN = [1, 1, 2, 2, 2, 2, 2];

const HOW: { title: string; text: string }[] = [
  {
    title: "I pledge, and anyone can help",
    text: "Half of my Colosseum winnings go to this line. Anyone can also send money straight to people in line.",
  },
  {
    title: "If I win, payouts start",
    text: "Within 14 days of the prize arriving. Nothing is locked before then.",
  },
  {
    title: "Money goes down the line",
    text: "In line order: self-backers first, then smallest claims first.",
  },
];

/** How this pledge works: a 1-2-3 band. Artizen give-back page only. */
export function HowBand() {
  return (
    <section className="band gb4-band" aria-labelledby="gb-how">
      <h2 id="gb-how">How this pledge works</h2>
      <ol className="steps gb4-steps">
        {HOW.map((h, i) => (
          <li className="step" key={h.title}>
            <span className="n">{i + 1}</span>
            <h3>{h.title}</h3>
            <p>{h.text}</p>
          </li>
        ))}
      </ol>
      <a className="gb4-band-link" href="/pledges/test-match-pool">
        See a pledge funded up front (test money)<Icon name="arrow" small />
      </a>
    </section>
  );
}

/** Who's backing it: Erin's funder card with live money tiles and her note, an open slot to help, then the rule as tiles. */
export function BackersSection({ stats }: { stats: LineStats }) {
  return (
    <section className="gb-sec" aria-labelledby="gb-backers">
      <SectionHead id="gb-backers" title="Who's backing it" />
      <div className="gb4-back">
        <article className="card gb-funder gb4-funder">
          <div className="gb-person">
            <span className="av tone-matching">EM</span>
            <b>Erin Magennis</b>
            <span className="chip gb-pledged">Pledged</span>
          </div>
          <p className="gb-amount">50% of my Colosseum winnings</p>
          <p className="gb-small">Pays out if I win.</p>
          <div className="gb4-money" aria-label="Money in place">
            {moneyRows(stats).map((r) => (
              <div className="gb4-tile" key={r.label}>
                <small>{r.label}</small>
                <b>{r.value}</b>
              </div>
            ))}
          </div>
          <span className="k gb4-live"><span className="live" />Live from the line</span>
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
        <article className="gb-invite gb4-invite">
          <span className="ico"><Icon name="plus" /></span>
          <h3>Back it too</h3>
          <p>
            Send USDC (a US dollar stablecoin) on Base straight to the next people in line. Pledger checks each payment and updates
            the line. Pledger never holds the money.
          </p>
          <div className="gb-invite-cta">
            <Button href="/claim/line#help" variant="ghost">Help pay people back</Button>
          </div>
        </article>
      </div>
      <div className="card gb4-rule" aria-label="The rule">
        <span className="k">The rule</span>
        <dl className="gb4-tiles">
          {ARTIZEN_RULE.rows.map((r, i) => (
            <div className={`gb4-tile s${RULE_SPAN[i] ?? 2}`} key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
        <p className="gb-rule-set">{ARTIZEN_RULE.setOn}</p>
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
