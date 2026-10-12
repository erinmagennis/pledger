import Link from "next/link";
import { Icon } from "./Icons";
import { KIND_LABEL, type Pledge } from "@/lib/pledges";

const WHO_BG: Record<Pledge["kind"], string> = {
  matching: "var(--sage-soft)",
  prize: "var(--sage-soft)",
  "give-back": "var(--peach-soft)",
};

export function PledgeCard({ pledge }: { pledge: Pledge }) {
  return (
    <Link className="pl" href={`/pledges/${pledge.slug}`}>
      <div className="top">
        <span className="who">
          <span className="av" style={{ background: WHO_BG[pledge.kind] }}>{pledge.by.initials}</span>
          {pledge.by.name}
        </span>
        <span className={`chip ${pledge.kind}`}>{KIND_LABEL[pledge.kind]}</span> {pledge.demo && <span className="chip demo">Demo · test money</span>}
      </div>
      <h3>{pledge.title}</h3>
      {pledge.progress !== undefined && (
        <div className="bar"><i style={{ width: `${pledge.progress * 100}%` }} /></div>
      )}
      <div className="stats">
        {(pledge.cardStats ?? pledge.stats).map((s) => (
          <div key={s.label}><b>{s.value}</b><small>{s.label}</small></div>
        ))}
      </div>
      <span className="go">View pledge <Icon name="arrow" /></span>
    </Link>
  );
}

export { WHO_BG };
