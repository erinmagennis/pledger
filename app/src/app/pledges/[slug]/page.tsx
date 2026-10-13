import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Icon, type IconName } from "@/components/Icons";
import { Button } from "@/components/Button";
import { PledgeHeader } from "@/components/pledge/PledgeHeader";
import { ActivityCard, BackersSection, HowCard, InPlaceCard, ProofStrip, SectionHead } from "@/components/pledge/PledgeCards";
import { LineWithPay } from "@/components/claim/LinePage";
import { WalletProvider } from "@/components/providers/WagmiProvider";
import { ZcashVerify } from "@/components/pledge/ZcashVerify";
import { ZcashNetworkView } from "@/components/pledge/ZcashNetworkView";
import { getLineData } from "@/lib/live";
import { ZCASH, ZCASH_MAINNET, ZCASH_SLUG, getPledge, getPledges, lineStats, withLiveLine, zcashMainnetRisks, zcashPledge, type ZcashPledgeData } from "@/lib/pledges";

type Params = { slug: string };

/** The Artizen give-back rule, one short line each. Shown once, in the header. */
const GIVE_BACK_FACTS: [IconName, string, string][] = [
  ["user", "Who pledges", "Erin Magennis"],
  ["trophy", "What", "50% of her Colosseum winnings (prize not yet decided)"],
  ["heart", "Who gets it", "Season 7 backers who paid the 10% fee"],
  ["list", "Order", "Self-backers first, then smallest claims"],
  ["coin", "When", "Within 14 days of the prize arriving, then weekly until used up"],
];

// Live line numbers for the give-back. Refreshed about every 30 seconds.
export const revalidate = 30;

export function generateStaticParams(): Params[] {
  // test-match-pool has its own route (src/app/pledges/demo).
  return getPledges()
    .filter((p) => p.slug !== "demo")
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
  if (base.slug === "artizen") {
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
                  Source: Artizen Payout Tracker, run by the community (not Pledger)
                </a>
              </>
            }
            extra={
              <ul className="gb4-facts" aria-label="The pledge">
                {GIVE_BACK_FACTS.map(([icon, k, v]) => (
                  <li key={k}>
                    <span className="gb4-fi"><Icon name={icon} small /></span>
                    <span className="gb4-fk">{k}</span>
                    <span className="gb4-fv">{v}</span>
                  </li>
                ))}
              </ul>
            }
            doors={[{ label: "Paid the fee?", action: "Check or add your claim", href: "/pledges/artizen/claim" }]}
          />
        </div>
        <BackersSection />
        <section className="gb-sec gb4-line" id="line" aria-labelledby="gb-line">
          <SectionHead id="gb-line" title="The line" />
          {/* Wallet only here, for paying people in line. */}
          <WalletProvider>
            <LineWithPay initial={st} />
          </WalletProvider>
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
        extra={<p className="zc-for">For funders who want to stay anonymous while anyone can still check the money.</p>}
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
      <div className="card zc-next">
        <div>
          <h2>Want to pledge privately?</h2>
          <Link className="zc-next-alt" href="/pledges/artizen">See a public pledge<Icon name="arrow" small /></Link>
        </div>
        <Button href="https://t.me/erinmagennis">Talk to us</Button>
      </div>
    </>
  );
}
