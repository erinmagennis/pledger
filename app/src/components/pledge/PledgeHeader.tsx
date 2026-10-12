import type { ReactNode } from "react";
import { Button } from "../Button";
import { Icon, type IconName } from "../Icons";
import { WHO_BG } from "../PledgeCard";
import { KIND_LABEL, type Pledge } from "@/lib/pledges";

/** One mini card on the right of the header, in the home hero float style. Desktop only. */
export type HeaderFloat = { icon: IconName; title: ReactNode; sub: ReactNode };

/** A labeled entry point under the title ("I paid the fee" over a button). Replaces stats and the default button. */
export type HeaderDoor = { label: string; action: string; href: string; variant?: "primary" | "ghost" };

export function PledgeHeader({
  pledge,
  float,
  sub,
  doors,
}: {
  pledge: Pledge;
  float?: HeaderFloat;
  sub?: ReactNode;
  doors?: HeaderDoor[];
}) {
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
      {sub && <p className="psub">{sub}</p>}
      {doors ? (
        <div className="doors">
          {doors.map((d) => (
            <div className="door" key={d.href}>
              <span className="door-k">{d.label}</span>
              <Button href={d.href} variant={d.variant}>{d.action}</Button>
            </div>
          ))}
        </div>
      ) : (
        <>
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
        </>
      )}
      {float && (
        <div className="float f2 phfloat">
          <span className="ic"><Icon name={float.icon} /></span>
          <div>
            <b>{float.title}</b>
            <small>{float.sub}</small>
          </div>
        </div>
      )}
    </header>
  );
}
