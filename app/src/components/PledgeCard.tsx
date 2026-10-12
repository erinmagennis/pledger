import Link from "next/link";
import { Icon } from "./Icons";
import { KIND_LABEL, type Pledge } from "@/lib/pledges";

const WHO_BG: Record<Pledge["kind"], string> = {
  matching: "var(--sage-soft)",
  prize: "var(--sage-soft)",
  "give-back": "var(--peach-soft)",
  private: "var(--ground)",
};

/** The funder avatar. A private funder gets a lock instead of a "?". */
export function WhoAvatar({ pledge }: { pledge: Pledge }) {
  if (pledge.kind === "private") {
    return <span className="av lock" style={{ background: WHO_BG.private }}><Icon name="lock" small /></span>;
  }
  return <span className="av" style={{ background: WHO_BG[pledge.kind] }}>{pledge.by.initials}</span>;
}

export function PledgeCard({ pledge }: { pledge: Pledge }) {
  return (
    <Link className="pl" href={`/pledges/${pledge.slug}`}>
      <div className="top">
        <span className="who">
          <WhoAvatar pledge={pledge} />
          {pledge.by.name}
        </span>
        <span className="chips">
          <span className={`chip ${pledge.kind}`}>{KIND_LABEL[pledge.kind]}</span>
          {(pledge.demo || pledge.testnet) && <span className="chip demo">Test money</span>}
        </span>
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
