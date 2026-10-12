import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Icon } from "@/components/Icons";
import { PledgeHeader } from "@/components/pledge/PledgeHeader";
import { ActivityCard, BackersSection, ClaimSection, HowCard, InPlaceCard, ProofStrip, RuleCard, SectionHead } from "@/components/pledge/PledgeCards";
import { LineCard } from "@/components/claim/LineCard";
import { ZcashVerify } from "@/components/pledge/ZcashVerify";
import { getLineData } from "@/lib/live";
import { ZCASH_SLUG, getPledge, getPledges, lineStats, withLiveLine } from "@/lib/pledges";

type Params = { slug: string };

// Live line numbers for the give-back. Refreshed about every 30 seconds.
export const revalidate = 30;

export function generateStaticParams(): Params[] {
  // test-match-pool has its own route (src/app/pledges/test-match-pool).
  return getPledges()
    .filter((p) => p.slug !== "test-match-pool")
    .map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const pledge = getPledge(slug);
  return { title: pledge ? `${pledge.title} · Pledger` : "Pledge not found · Pledger" };
}

export default async function PledgePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const base = getPledge(slug);
  if (!base) notFound();
  if (base.slug === "artizen-give-back") {
    const st = lineStats((await getLineData()).line);
    const pledge = withLiveLine(base, st);
    return (
      <>
        <Link className="back" href="/#live"><Icon name="arrow" small />All pledges</Link>
        <PledgeHeader
          pledge={pledge}
          hideBy
          sub="For people who paid Artizen's 10% endowment fee in Season 7. People who backed their own project go first."
          doors={[{ label: "Paid the fee?", action: "Check or add your claim", href: "/claim" }]}
          float={{ icon: "shield", title: "Claims checked by email signature", sub: "Season 7 receipts" }}
        />
        <RuleCard stats={st} />
        <BackersSection />
        <ClaimSection />
        <section className="gb-sec" aria-labelledby="gb-line">
          <SectionHead id="gb-line" title="The line" />
          <LineCard initial={st} />
        </section>
        <ProofStrip pledge={pledge} />
      </>
    );
  }

  if (base.slug === ZCASH_SLUG) {
    return (
      <>
        <Link className="back" href="/#live"><Icon name="arrow" small />All pledges</Link>
        <PledgeHeader
          pledge={base}
          hideBy
          sub="The money is visible to anyone with the viewing key. Who gave it is not. The key cannot spend."
        />
        <section className="pgrid">
          <div className="pcol">
            <ActivityCard pledge={base} />
            <HowCard pledge={base} />
          </div>
          <div className="pcol side">
            <InPlaceCard pledge={base} />
            <ZcashVerify />
            <p className="zc-quiet">
              Anyone with the key can read memos. A funder who pays from a transparent address is visible on chain anyway.
            </p>
          </div>
        </section>
      </>
    );
  }

  const pledge = base;
  return (
    <>
      <Link className="back" href="/#live"><Icon name="arrow" small />All pledges</Link>
      <PledgeHeader pledge={pledge} />
      <section className="pgrid">
        <div className="pcol">
          <ActivityCard pledge={pledge} />
          <HowCard pledge={pledge} />
        </div>
        <div className="pcol side">
          <InPlaceCard pledge={pledge} />
        </div>
      </section>
    </>
  );
}
