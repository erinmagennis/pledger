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

// TODO(copy): placeholder note for the Artizen give-back. Erin to replace with her own words.
/** Erin's note on the give-back page. A quiet strip, not a card. */
export function GiveBackNote() {
  return (
    <section className="pnote" aria-labelledby="pnote-h">
      <span className="av tone-give-back">EM</span>
      <div>
        <h2 id="pnote-h" className="pnote-k">Why I&apos;m doing this</h2>
        <p>
          The 10% fee came out of money you put behind builders, me included. If I win at Colosseum,
          half of it comes back to you. Self-backers go first because they paid the fee on their own work.
        </p>
        <p className="sig">Erin</p>
      </div>
    </section>
  );
}

/** How it works (left) and the facts plus dated activity (right). Plain section with a hairline on top. */
export function HowProof({ pledge }: { pledge: Pledge }) {
  const facts = [
    { label: "Share pledged", value: "50% of Colosseum winnings" },
    { label: "Who can claim", value: "People who paid the 10% fee" },
    { label: "Chain", value: pledge.chain },
    { label: "Records", value: `On ${pledge.chain} via EAS` },
  ];
  return (
    <section className="hproof" aria-labelledby="hproof-h">
      <h2 id="hproof-h">How it works and proof</h2>
      <div className="hproof-grid">
        <ol className="how">
          {pledge.howItWorks.map((h, i) => <li key={i}>{h}</li>)}
        </ol>
        <div>
          <dl className="facts">
            {facts.map((f) => (
              <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>
            ))}
          </dl>
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
      </div>
    </section>
  );
}
