import { formatCents } from "@/lib/claims";
import type { Totals } from "@/lib/pledges";
import { Icon } from "../Icons";
import { Sparkline } from "./Sparkline";
import { TimeAgo } from "./TimeAgo";

const AV_BG = ["var(--peach-soft)", "var(--sage-soft)", "var(--butter-soft)"];

/** renderedAt = unix seconds of the server render, for relative times. */
export function Tracker({ totals, renderedAt }: { totals: Totals; renderedAt: number }) {
  const more = totals.peopleCount - totals.people.length;
  // Lead with the demo total while real payouts are still $0; the real number stays one line below.
  const demoLead = totals.testnetCents > 0;
  return (
    <div className="card tracker">
      <span className="k"><span className="live" />Paid out through Pledger</span>
      <div className="big">{formatCents(demoLead ? totals.testnetCents : totals.paidCents)}</div>
      {demoLead && (
        <p className="testnet-line">
          <span className="chip demo">Test money</span>
          {formatCents(totals.paidCents)} real so far
        </p>
      )}
      {totals.peopleCount > 0 && (
        <div className="ppl">
          <span className="stack">
            {totals.people.map((p, i) => (
              <span key={i} className="av" style={{ background: AV_BG[i % AV_BG.length] }}>{p}</span>
            ))}
            {more > 0 && <span className="av" style={{ background: "#eee" }}>+{more}</span>}
          </span>
          <span className="k">{totals.peopleCount} {totals.peopleCount === 1 ? "person" : "people"} in line</span>
        </div>
      )}
      {!totals.flat && (
        <figure className="tchart">
          <Sparkline series={totals.series} />
          <figcaption>{totals.seriesDemo ? "Paid out over time (test money)" : "Paid out over time"}</figcaption>
        </figure>
      )}
      {totals.feed.length > 0 && (
        <ul className="tfeed" aria-label="Latest activity">
          {totals.feed.map((f) => (
            <li key={f.href}>
              <a href={f.href} target="_blank" rel="noreferrer">
                {f.av ? (
                  <span className="av person"><Icon name="user" small /></span>
                ) : (
                  <span className="av ic"><Icon name="undo" small /></span>
                )}
                <span className="tx">
                  <b>{f.text}</b>
                  <small>
                    {f.testnet && <span className="chip demo">Test money</span>}
                    <TimeAgo unix={f.time} renderedAt={renderedAt} />
                  </small>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {totals.byKind.length > 0 && (
        <div className="tfoot">
          <div className="seg">
            {totals.byKind.map((k) => (
              <i key={k.kind} className={`tone-${k.kind}`} style={{ flex: k.cents }} />
            ))}
          </div>
          <div className="legend">
            {totals.byKind.map((k) => (
              <span key={k.kind}><i className={`tone-${k.kind}`} />{k.label} {formatCents(k.cents)}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
