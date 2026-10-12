import { Band } from "@/components/home/Band";
import { Hero } from "@/components/home/Hero";
import { Kinds } from "@/components/home/Kinds";
import { LivePledges } from "@/components/home/LivePledges";
import { Tracker } from "@/components/home/Tracker";
import { getPledge, getPledges, getTotals } from "@/lib/pledges";

export default function Home() {
  const pledges = getPledges();
  const featured = getPledge("test-match-pool") ?? pledges[0];
  return (
    <>
      <Hero featured={featured} />
      <section className="grid">
        <Tracker totals={getTotals()} />
        <Kinds />
      </section>
      <Band />
      <LivePledges pledges={pledges} />
    </>
  );
}
