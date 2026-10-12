import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Icon } from "@/components/Icons";
import { PledgeHeader } from "@/components/pledge/PledgeHeader";
import { ActivityCard, HelpCard, HowCard, InPlaceCard, WhyNoteCard } from "@/components/pledge/PledgeCards";
import { getPledge, getPledges } from "@/lib/pledges";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return getPledges().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const pledge = getPledge(slug);
  return { title: pledge ? `${pledge.title} · Pledger` : "Pledge not found · Pledger" };
}

export default async function PledgePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const pledge = getPledge(slug);
  if (!pledge) notFound();
  const isGiveBack = pledge.slug === "artizen-give-back";

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
          {isGiveBack && <WhyNoteCard />}
          {isGiveBack && <HelpCard />}
        </div>
      </section>
    </>
  );
}
