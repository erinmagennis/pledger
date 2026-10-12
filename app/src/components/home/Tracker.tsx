import { formatUsd, type Totals } from "@/lib/pledges";
import { Sparkline } from "./Sparkline";

const AV_BG = ["var(--peach-soft)", "var(--sage-soft)", "var(--butter-soft)"];

export function Tracker({ totals }: { totals: Totals }) {
  const more = totals.peoplePaid - totals.recentPeople.length;
  return (
    <div className="card tracker">
      <span className="k"><span className="live" />Paid out through Pledger</span>
      <div className="big">{formatUsd(totals.paidOut)}</div>
      <div className="ppl">
        <span className="stack">
          {totals.recentPeople.map((p, i) => (
            <span key={p} className="av" style={{ background: AV_BG[i % AV_BG.length] }}>{p}</span>
          ))}
          {more > 0 && <span className="av" style={{ background: "#eee" }}>+{more}</span>}
        </span>
        <span className="k">{totals.peoplePaid} people paid</span>
      </div>
      <Sparkline series={totals.series} />
      <div className="seg">
        {totals.byKind.map((k) => (
          <i key={k.kind} className={`tone-${k.kind}`} style={{ flex: k.amount }} />
        ))}
      </div>
      <div className="legend">
        {totals.byKind.map((k) => (
          <span key={k.kind}><i className={`tone-${k.kind}`} />{k.label} {formatUsd(k.amount)}</span>
        ))}
      </div>
    </div>
  );
}
