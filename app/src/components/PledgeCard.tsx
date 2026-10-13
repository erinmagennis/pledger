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

/**
 * One pledge card. The "View pledge" link is stretched over the whole card (CSS ::after), so the card stays
 * clickable without wrapping it in an anchor. `action` (a button) sits above that link, so there are no nested links.
 */
export function PledgeCard({ pledge, action }: { pledge: Pledge; action?: React.ReactNode }) {
  const testMoney = pledge.demo || pledge.testnet;
  return (
    <article className="pl">
      <div className="top">
        <span className="who">
          <WhoAvatar pledge={pledge} />
          {pledge.by.name}
        </span>
        <span className="chips">
          {testMoney ? <span className="chip demo">Test money</span> : <span className={`chip ${pledge.kind}`}>{KIND_LABEL[pledge.kind]}</span>}
        </span>
      </div>
      <h3>{pledge.title}</h3>
      <div className="pl-bottom">
        {pledge.progress !== undefined && (
          <div className="bar"><i style={{ width: `${pledge.progress * 100}%` }} /></div>
        )}
        <div className="stats">
          {(pledge.cardStats ?? pledge.stats).map((s) => (
            <div key={s.label}><b>{s.value}</b><small>{s.label}</small></div>
          ))}
        </div>
        <div className="pl-foot">
          <Link className="go pl-link" href={`/pledges/${pledge.slug}`}>
            View pledge<span className="sr-only">: {pledge.title}</span> <Icon name="arrow" />
          </Link>
          {action && <div className="pl-action">{action}</div>}
        </div>
      </div>
    </article>
  );
}

export { WHO_BG };
