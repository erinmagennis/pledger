import { Band } from "@/components/home/Band";
import { Hero } from "@/components/home/Hero";
import { Kinds } from "@/components/home/Kinds";
import { LivePledges } from "@/components/home/LivePledges";
import { Tracker } from "@/components/home/Tracker";
import { getLineData, getLivePool } from "@/lib/live";
import { computeTotals, getPledges, lineStats, withLiveLine, withLivePool } from "@/lib/pledges";
import "@/styles/home-v4.css";

// Live data: Tempo testnet pool and the Supabase line. Refreshed about every 30 seconds.
export const revalidate = 30;

export default async function Home() {
  const [pool, lineData] = await Promise.all([getLivePool(), getLineData()]);
  const stats = lineStats(lineData.line);
  const pledges = getPledges().map((p) => {
    if (p.slug === "demo" && pool) return withLivePool(p, pool);
    if (p.slug === "artizen") return withLiveLine(p, stats);
    return p;
  });
  const featured = pledges.find((p) => p.slug === "demo") ?? pledges[0]!;
  return (
    <>
      <Hero featured={featured} pool={pool} />
      <section className="grid">
        <Tracker totals={computeTotals(pool, lineData.line, lineData.payments)} renderedAt={pool?.fetchedAt ?? Math.floor(Date.now() / 1000)} />
        <Kinds matched={pool?.totalMatched ?? null} />
      </section>
      <Band />
      <LivePledges pledges={pledges} />
    </>
  );
}
