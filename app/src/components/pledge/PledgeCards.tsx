import { Button } from "../Button";
import { Icon } from "../Icons";
import type { Pledge } from "@/lib/pledges";

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

/** Who's backing it: Erin's funder card with her note, and a compact card to help. The numbers live in the line section. */
export function BackersSection() {
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
          <div className="gb4-invite-top">
            <span className="ico"><Icon name="plus" /></span>
            <h3>Back it too</h3>
          </div>
          <p>Pay by card (Stripe, test mode for now) or with USDC on Base. The money goes straight to people in line.</p>
          <div className="gb-invite-cta">
            <Button href="/pledges/artizen#help" variant="ghost">Help pay people back</Button>
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
