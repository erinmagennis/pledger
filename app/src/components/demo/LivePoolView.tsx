"use client";

// Shared template for every match pool page: the example pledge and pledges made at /make.
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PledgeHeader } from "../pledge/PledgeHeader";
import { headerPledge, poolNumbers } from "@/lib/poolview";
import { dollars, type PoolConfig } from "@/lib/selfserve";
import { usd, type PoolData } from "@/lib/tempo";
import { TimeAgo } from "../home/TimeAgo";
import { TryIt } from "./TryIt";
import { PoolFeed, PoolHow, PoolStats, TestBanner } from "./PoolCards";
import type { GiveResult } from "./give";

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

export function LivePoolView({
  cfg,
  initial,
  api,
  title,
  by,
  sub,
  example,
  extra,
}: {
  cfg: PoolConfig;
  initial: PoolData | null;
  /** Where the client refreshes live data from. */
  api: string;
  title: string;
  by: { name: string; initials: string };
  sub?: ReactNode;
  /** True for the example pledge; false for pledges made at /make. */
  example: boolean;
  /** Optional block under the banner (a share link on new pledges). */
  extra?: ReactNode;
}) {
  const [data, setData] = useState<PoolData | null>(initial);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(api, { cache: "no-store" });
      if (!res.ok) return;
      const fresh = (await res.json()) as PoolData;
      setData((cur) => (!cur || fresh.donationCount >= cur.donationCount ? fresh : cur));
    } catch {
      /* keep what we have */
    }
  }, [api]);

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
      setTimeout(refresh, 12_000);
    },
    [refresh],
  );

  const n = poolNumbers(cfg, data);
  const pledge = headerPledge(cfg, n, { title, by, demo: example });
  const latest = data?.events.find((e) => e.kind === "donated");
  const float = latest && data
    ? {
        icon: "check" as const,
        title: latest.match && latest.match !== "$0" ? `${latest.match} matched` : `${latest.amount} given`,
        sub: <><TimeAgo unix={latest.time} renderedAt={data.fetchedAt} /> · to {cfg.recipientLabel}</>,
      }
    : undefined;

  return (
    <>
      <TestBanner example={example} />
      {extra}
      <PledgeHeader pledge={pledge} float={float} sub={sub} hideAction hideTestChip />
      <section className="pgrid demo">
        <div className="pcol">
          <TryIt onGiven={onGiven} pool={cfg.address as `0x${string}`} recipientLabel={cfg.recipientLabel} capLabel={dollars(cfg.capUsd)} />
          <PoolHow cfg={cfg} n={n} />
          <PoolFeed cfg={cfg} data={data} sponsorLabel={example ? by.name : "The funder"} />
        </div>
        <div className="pcol side">
          <PoolStats cfg={cfg} n={n} live={!!data} />
        </div>
      </section>
    </>
  );
}
