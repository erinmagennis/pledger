import { Button } from "../Button";
import { Icon } from "../Icons";
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
            <span className={r.ok ? "ok" : undefined}>{r.value}</span>
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

// TODO(copy): placeholder copy for the Artizen give-back. Erin to replace with her own words.
export function WhyNoteCard() {
  return (
    <div className="card note">
      <span className="ico"><Icon name="heart" /></span>
      <h2>Why I&apos;m doing this</h2>
      <p>The 10% fee came out of your support for builders. If I win, half of it goes back to you.</p>
    </div>
  );
}

export function HelpCard() {
  return (
    <div className="card note sage">
      <span className="ico"><Icon name="undo" /></span>
      <h2>Want to help?</h2>
      <p>You can pay claimants directly. Pledger checks each payment and adds it to the log.</p>
      <div className="ctas" style={{ marginTop: 18 }}>
        <Button href="/claim" variant="ghost">See who is in line</Button>
      </div>
    </div>
  );
}
