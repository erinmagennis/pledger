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
        <span className="eyebrow"><span className="live" />A payment only counts once it is verified onchain</span>
        <h1>Pledges you can <em>trust</em>.</h1>
        <p className="sub">See the money behind every pledge, and know when it will land.</p>
        <div className="ctas">
          <Button href="/pledges/demo#try">Try the demo</Button>
          <Button href="/pledges/artizen" variant="ghost">Get your Artizen 10% fee back</Button>
        </div>
      </div>
      <div className="stage">
        <div className="artslot" aria-hidden="true" />
        {latest && pool && (
          <div className="float f2">
            <span className="ic"><Icon name="check" /></span>
            <div>
              <b>{matched ? `${latest.match} matched` : `${latest.amount} given`}</b>
              <small><TimeAgo unix={latest.time} renderedAt={pool.fetchedAt} /> · confirmed</small>
            </div>
          </div>
        )}
        <div className="float f1">
          <span className="t">Match pool</span>
          <div className="chips">
            <span className={`chip ${featured.kind}`}>{KIND_LABEL[featured.kind]}</span>
            {(featured.demo || featured.testnet) && <span className="chip demo">Test money</span>}
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
