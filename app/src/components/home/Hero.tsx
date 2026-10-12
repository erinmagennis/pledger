import { Button } from "../Button";
import { Icon } from "../Icons";
import { KIND_LABEL, type Pledge } from "@/lib/pledges";
import type { PoolData } from "@/lib/tempo";
import { TimeAgo } from "./TimeAgo";

/** featured = the test match pool, with live numbers merged when pool is not null. */
export function Hero({ featured, pool }: { featured: Pledge; pool: PoolData | null }) {
  const progress = featured.progress ?? 0;
  const latest = pool?.events.find((e) => e.kind === "donated");
  const matched = latest && latest.match && latest.match !== "$0";
  return (
    <header className="hero">
      <div>
        <span className="eyebrow"><span className="live" />Every payment checked on chain</span>
        <h1>Pledges you can <em>trust</em>.</h1>
        <p className="sub">See the money behind every pledge, and know when it lands.</p>
        <div className="ctas">
          <Button href="/make">Make a pledge</Button>
          <Button href="/pledges/test-match-pool" variant="ghost">Try the demo</Button>
        </div>
      </div>
      <div className="stage">
        <div className="artslot">Hero art (Higgsfield)</div>
        {latest && pool && (
          <div className="float f2">
            <span className="ic"><Icon name="check" /></span>
            <div>
              <b>{matched ? `Demo: ${latest.match} matched with test money` : `Demo: ${latest.amount} given with test money`}</b>
              <small><TimeAgo unix={latest.time} renderedAt={pool.fetchedAt} /> · checked</small>
            </div>
          </div>
        )}
        <div className="float f1">
          <span className="t">{featured.title}</span>
          <div className="chips">
            <span className={`chip ${featured.kind}`}>{KIND_LABEL[featured.kind]}</span>
            {featured.demo && <span className="chip demo">Demo · test money</span>}
            {featured.testnet && <span className="chip demo">Testnet · test money</span>}
          </div>
          {pool ? (
            <>
              <div className="amt">{pool.pool} <span>left to match</span></div>
              <div className="bar"><i style={{ width: `${progress * 100}%` }} /></div>
              <div className="meta"><span>{pool.totalMatched} matched</span><span>until 31 Dec</span></div>
            </>
          ) : (
            <>
              <div className="amt">$500 <span>put in place</span></div>
              <div className="meta"><span>1:1 match, up to $20</span><span>until 31 Dec</span></div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
