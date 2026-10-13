import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Icon } from "@/components/Icons";
import { PledgeHeader } from "@/components/pledge/PledgeHeader";
import { ActivityCard, BackersSection, ClaimSection, HowBand, HowCard, InPlaceCard, ProofStrip, SectionHead } from "@/components/pledge/PledgeCards";
import { LineCard } from "@/components/claim/LineCard";
import { ZcashVerify } from "@/components/pledge/ZcashVerify";
import { ZcashNetworkView } from "@/components/pledge/ZcashNetworkView";
import { getLineData } from "@/lib/live";
import { ZCASH, ZCASH_MAINNET, ZCASH_SLUG, getPledge, getPledges, lineStats, withLiveLine, zcashMainnetRisks, zcashPledge, type ZcashPledgeData } from "@/lib/pledges";

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
        <div className="gb4-head">
          <PledgeHeader
            pledge={pledge}
            hideBy
            sub={
              <>
                Artizen promised match funding on every purchase and charged backers a 10% endowment fee. In October
                2026 it shut down. There is no sign the promised match will be paid or the fees returned.{" "}
                <a className="gb4-src" href="https://payout-progress-artizen.pages.dev/" target="_blank" rel="noopener noreferrer">
                  Source: community payout tracker
                </a>
                <span className="gb4-for">
                  This pledge puts half of my Colosseum winnings toward paying that fee back to Season 7 backers.
                </span>
              </>
            }
            doors={[{ label: "Paid the fee?", action: "Check or add your claim", href: "/claim" }]}
          />
        </div>
        <HowBand />
        <BackersSection stats={st} />
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
    const main = ZCASH_MAINNET;
    return (
      <>
        <Link className="back" href="/#live"><Icon name="arrow" small />All pledges</Link>
        <ZcashNetworkView
          testnet={<ZcashBody d={ZCASH} />}
          mainnet={
            main.published ? (
              <ZcashBody d={main} />
            ) : (
              <>
                <div className="card net-note">
                  <span className="k"><span className="live still" />Zcash mainnet</span>
                  <h2>Mainnet pledge: coming.</h2>
                  <p>The funder&apos;s wallet is being set up. The viewing key will be published here.</p>
                </div>
                <p className="net-label">Below: the same pledge on Zcash testnet, with test money.</p>
                <ZcashBody d={ZCASH} />
              </>
            )
          }
        />
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

/** One Zcash pledge (testnet proof or mainnet), from its snapshot data. */
function ZcashBody({ d }: { d: ZcashPledgeData }) {
  const pledge = zcashPledge(d);
  const main = d.networkId === "mainnet";
  return (
    <>
      <PledgeHeader
        pledge={pledge}
        hideBy
        sub="The money is visible to anyone with the viewing key. Who gave it is not. The key cannot spend."
      />
      <section className="pgrid">
        <div className="pcol">
          {main && (
            <div className="card">
              <h2>Before you rely on this</h2>
              <ul className="zc-risks">
                {zcashMainnetRisks(d).map((r) => <li key={r}>{r}</li>)}
              </ul>
            </div>
          )}
          <ActivityCard pledge={pledge} />
          <HowCard pledge={pledge} />
        </div>
        <div className="pcol side">
          <InPlaceCard pledge={pledge} />
          <ZcashVerify d={d} />
          {!main && (
            <p className="zc-quiet">
              Anyone with the key can read memos. A funder who pays from a transparent address is visible on chain anyway.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
