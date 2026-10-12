"use client";

import { useCallback, useEffect, useState } from "react";
import { PledgeHeader } from "../pledge/PledgeHeader";
import { HowCard, InPlaceCard } from "../pledge/PledgeCards";
import { withLivePool, type Pledge } from "@/lib/pledges";
import { MATCH_POOL, addressUrl, usd, type PoolData } from "@/lib/tempo";
import { TryIt } from "./TryIt";
import type { GiveResult } from "./give";

const API = "/api/pools/test-match-pool";

/** Adds a just-made gift to the pool data so the page updates before the 10s cache does. */
function addGift(d: PoolData, r: GiveResult): PoolData {
  if (d.events.some((e) => e.tx === r.donateTx)) return d;
  const pool = BigInt(d.poolUnits) - r.matchUnits;
  const matched = BigInt(d.matchedUnits) + r.matchUnits;
  const donated = BigInt(d.donatedUnits) + r.amountUnits;
  return {
    ...d,
    pool: usd(pool),
    poolUnits: pool.toString(),
    totalMatched: usd(matched),
    matchedUnits: matched.toString(),
    totalDonated: usd(donated),
    donatedUnits: donated.toString(),
    donationCount: d.donationCount + 1,
    events: [
      {
        kind: "donated",
        tx: r.donateTx,
        block: r.block,
        time: r.time,
        who: r.who,
        amount: usd(r.amountUnits),
        match: usd(r.matchUnits),
        amountUnits: r.amountUnits.toString(),
        matchUnits: r.matchUnits.toString(),
      },
      ...d.events,
    ],
  };
}

export function LivePoolView({ base, initial }: { base: Pledge; initial: PoolData | null }) {
  const [data, setData] = useState<PoolData | null>(initial);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(API, { cache: "no-store" });
      if (!res.ok) return;
      const fresh = (await res.json()) as PoolData;
      setData((cur) => (!cur || fresh.donationCount >= cur.donationCount ? fresh : cur));
    } catch {
      /* keep what we have */
    }
  }, []);

  // The server render can be a few seconds stale; refresh on load and every 20s while open.
  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  const onGiven = useCallback(
    (r: GiveResult) => {
      setData((cur) => (cur ? addGift(cur, r) : cur));
      // The API caches for about 10s; sync with the chain once it has caught up.
      setTimeout(refresh, 12_000);
    },
    [refresh],
  );

  const pledge = data ? withLivePool(base, data) : base;

  return (
    <>
      <PledgeHeader pledge={pledge} />
      <section className="pgrid">
        <div className="pcol">
          <TryIt onGiven={onGiven} />
          <div className="card">
            <h2>Activity</h2>
            {pledge.activity.length === 0 ? (
              <p className="demo-empty">{data ? "No gifts yet." : "Live activity could not be read from Tempo just now."}</p>
            ) : (
              <ol className="log">
                {pledge.activity.map((a, i) => (
                  <li key={a.href ?? i}>
                    <time>{a.date}</time>
                    {a.href ? (
                      <a className="demo-tx" href={a.href} target="_blank" rel="noreferrer">{a.text}</a>
                    ) : (
                      <span>{a.text}</span>
                    )}
                    {a.amount ? <b>{a.amount}</b> : <span />}
                  </li>
                ))}
              </ol>
            )}
            <p className="demo-src">
              Read from the <a href={addressUrl(MATCH_POOL)} target="_blank" rel="noreferrer">pool contract on Tempo</a>.
            </p>
          </div>
          <HowCard pledge={pledge} />
        </div>
        <div className="pcol side">
          <InPlaceCard pledge={pledge} />
        </div>
      </section>
    </>
  );
}
