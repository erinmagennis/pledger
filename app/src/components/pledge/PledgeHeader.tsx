import { Button } from "../Button";
import { WHO_BG } from "../PledgeCard";
import { KIND_LABEL, type Pledge } from "@/lib/pledges";

export function PledgeHeader({ pledge }: { pledge: Pledge }) {
  return (
    <header className={`phead ${pledge.kind}`}>
      <div className="meta-row">
        <span className={`chip ${pledge.kind}`}>{KIND_LABEL[pledge.kind]}</span>
        <span className="who">
          <span className="av" style={{ background: WHO_BG[pledge.kind] }}>{pledge.by.initials}</span>
          Pledged by {pledge.by.name}
        </span>
      </div>
      <h1>{pledge.title}</h1>
      <div className="pstats">
        {pledge.stats.map((s) => (
          <div key={s.label}><b>{s.value}</b><small>{s.label}</small></div>
        ))}
      </div>
      {pledge.progress !== undefined && (
        <div className="bar"><i style={{ width: `${pledge.progress * 100}%` }} /></div>
      )}
      <div className="ctas">
        <Button href={pledge.action.href}>{pledge.action.label}</Button>
      </div>
    </header>
  );
}
