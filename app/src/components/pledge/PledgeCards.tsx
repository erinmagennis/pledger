import { Button } from "../Button";
import { Icon } from "../Icons";
import { moneyRows, type LineStats, type Pledge } from "@/lib/pledges";

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

const HOW: { title: string; text: string }[] = [
  { title: "I pledge, anyone can add", text: "Half my winnings, plus anything others send." },
  { title: "If I win, payouts start", text: "Nothing is locked before then." },
  { title: "Money goes down the line", text: "In line order, straight to wallets." },
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

/** Who's backing it: Erin's funder card with live money tiles and her note, an open slot to help, the line's money tiles once. */
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
          <p>Pay by card (Stripe, test mode for now) or with USDC on Base. The money goes straight to people in line.</p>
          <div className="gb-invite-cta">
            <Button href="/claim/line#help" variant="ghost">Help pay people back</Button>
          </div>
        </article>
      </div>
    </section>
  );
}

/** Proof: a slim, quiet strip at the bottom. Fact chips, then the dated entries, oldest first. */
export function ProofStrip({ pledge }: { pledge: Pledge }) {
  const facts = [`Records public on ${pledge.chain}`];
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
