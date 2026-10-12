import { formatCents } from "@/lib/claims";
import type { Totals } from "@/lib/pledges";
import { Sparkline } from "./Sparkline";

const AV_BG = ["var(--peach-soft)", "var(--sage-soft)", "var(--butter-soft)"];

export function Tracker({ totals }: { totals: Totals }) {
  const more = totals.peopleCount - totals.people.length;
  return (
    <div className="card tracker">
      <span className="k"><span className="live" />Paid out through Pledger</span>
      <div className="big">{formatCents(totals.paidCents)}</div>
      {totals.testnetCents > 0 && <p className="testnet-line">plus {formatCents(totals.testnetCents)} sent on testnet in the demo</p>}
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
      <Sparkline series={totals.series} flat={totals.flat} />
      {totals.byKind.length > 0 && (
        <>
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
        </>
      )}
    </div>
  );
}
