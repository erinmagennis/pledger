import { Icon } from "../Icons";
import { TimeAgo } from "../home/TimeAgo";
import { facts, feed, howSteps, type PoolNumbers } from "@/lib/poolview";
import { dollars, type PoolConfig } from "@/lib/selfserve";
import type { LiveNums } from "@/lib/poolview";

/** The one place a pool page says it runs on test money. */
export function TestBanner({ example }: { example: boolean }) {
  return (
    <div className="ss-banner" role="note">
      <span className="ss-banner-ic"><Icon name="coin" small /></span>
      <p>
        <b>{example ? "Example pledge on testnet." : "Test pledge on testnet."}</b>{" "}
        Try it with test money. Nothing here is real money.
      </p>
    </div>
  );
}

/** Stat tiles, a used-vs-left bar and the checkable facts. */
export function PoolStats({ cfg, n, live }: { cfg: PoolConfig; n: PoolNumbers; live: boolean }) {
  const usedPct = Math.round(n.used * 100);
  return (
    <div className="card ss-stats">
      <span className="k"><span className={live ? "live" : "live still"} />{live ? "Live from the pool contract" : "Waiting for live numbers"}</span>
      <div className="ss-big">
        <b>{dollars(n.left)}</b>
        <small>left to match, of {dollars(n.deposited || cfg.poolUsd)}</small>
      </div>
      <div className="ss-meter" role="img" aria-label={`${usedPct}% of the pool used as match`}>
        <i style={{ width: `${Math.max(n.used > 0 ? 2 : 0, usedPct)}%` }} />
      </div>
      <div className="ss-legend">
        <span><i className="sw used" />Matched {dollars(n.matched)}</span>
        <span><i className="sw left" />Left {dollars(n.left)}</span>
      </div>
      <div className="ss-tiles">
        <div className="ss-tile"><b>{n.gifts}</b><small>{n.gifts === 1 ? "gift" : "gifts"}</small></div>
        <div className="ss-tile"><b>{dollars(n.given)}</b><small>given</small></div>
        <div className="ss-tile"><b>{dollars(n.given + n.matched)}</b><small>arrived</small></div>
      </div>
      <dl className="ss-facts">
        {facts(cfg, n).map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.href ? <a href={f.href} target="_blank" rel="noreferrer">{f.value}</a> : f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const TONES = ["tone-matching", "tone-prize", "tone-give-back"];

/** Activity as a feed: avatar, who and what, match chip, time, link to the transaction. */
export function PoolFeed({ cfg, data, sponsorLabel }: { cfg: PoolConfig; data: LiveNums | null; sponsorLabel: string }) {
  const items = feed(data, cfg, sponsorLabel);
  return (
    <div className="card">
      <h2>Activity</h2>
      {items.length === 0 ? (
        <p className="ss-empty">{data ? "No gifts yet. Be the first." : "Live activity could not be read from Tempo just now."}</p>
      ) : (
        <ol className="ss-feed">
          {items.slice(0, 12).map((it) => (
            <li key={it.key}>
              {it.kind === "deposited" ? (
                <span className="ss-av ss-av-ic"><Icon name="lock" small /></span>
              ) : (
                <span className={`ss-av ${TONES[it.tone]}`}>{it.initials}</span>
              )}
              <div className="ss-feed-main">
                <a href={it.href} target="_blank" rel="noreferrer">{it.title}</a>
                <small><TimeAgo unix={it.time} renderedAt={data?.fetchedAt ?? it.time} /></small>
              </div>
              {it.match ? <span className="chip matching ss-match">+{it.match} match</span> : <span />}
            </li>
          ))}
        </ol>
      )}
      {items.length > 12 && <p className="ss-more">Showing the latest 12 of {items.length}.</p>}
    </div>
  );
}

/** How this pledge works: four numbered steps with icons. */
export function PoolHow({ cfg, n }: { cfg: PoolConfig; n: PoolNumbers }) {
  return (
    <div className="card">
      <h2>How this pledge works</h2>
      <ol className="ss-how">
        {howSteps(cfg, n).map((s, i) => (
          <li key={s.title}>
            <span className="ss-how-ic"><Icon name={s.icon} /><em>{i + 1}</em></span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
