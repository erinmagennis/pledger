import { Button } from "../Button";
import { Icon } from "../Icons";
import { KIND_LABEL, type Pledge } from "@/lib/pledges";

export function Hero({ featured }: { featured: Pledge }) {
  const [inPlace, matched, until] = featured.stats;
  const progress = featured.progress ?? 0;
  const left = featured.inPlace.find((r) => r.label === "Left to match")?.value;
  return (
    <header className="hero">
      <div>
        <span className="eyebrow"><span className="live" />Every payment checked on chain</span>
        <h1>Pledges you can <em>trust</em>.</h1>
        <p className="sub">See the money behind every pledge, and know when it lands.</p>
        <div className="ctas">
          <Button href="/#make">Make a pledge</Button>
          <Button href="/#live" variant="ghost">See live pledges</Button>
        </div>
      </div>
      <div className="stage">
        <div className="artslot">Hero art (Higgsfield)</div>
        {/* TODO(data): latest verified payment */}
        <div className="float f2">
          <span className="ic"><Icon name="check" /></span>
          <div><b>$25 sent to M. R.</b><small>2 hours ago · checked</small></div>
        </div>
        <div className="float f1">
          <div className="row">
            <span className="t">{featured.title}</span>
            <span className={`chip ${featured.kind}`}>{KIND_LABEL[featured.kind]}</span>
          </div>
          <div className="amt">{inPlace.value} <span>{until.label} {until.value}</span></div>
          <div className="bar"><i style={{ width: `${progress * 100}%` }} /></div>
          <div className="meta"><span>{matched.value} matched</span>{left && <span>{left} left</span>}</div>
        </div>
      </div>
    </header>
  );
}
