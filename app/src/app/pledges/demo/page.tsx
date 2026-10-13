import Link from "next/link";
import type { Metadata } from "next";
import { Icon } from "@/components/Icons";
import { LivePoolView } from "@/components/demo/LivePoolView";
import { MainnetOnly } from "@/components/NetSwitch";
import { EXAMPLE, EXAMPLE_POOL } from "@/lib/poolview";
import { readPool, type PoolData } from "@/lib/tempo";
import "@/styles/selfserve.css";

// Live pool data from Tempo testnet, refreshed about every 10 seconds.
export const revalidate = 10;

export const metadata: Metadata = { title: `${EXAMPLE.title} · Pledger` };

export default async function TestMatchPoolPage() {
  let initial: PoolData | null = null;
  try {
    initial = await readPool();
  } catch {
    initial = null; // the client view retries from /api/pools/test-match-pool
  }
  return (
    <>
      <Link className="back" href="/#live"><Icon name="arrow" small />All pledges</Link>
      <MainnetOnly>
        <div className="card net-note">
          <span className="k"><span className="live still" />Mainnet</span>
          <p>Mainnet pool: coming. The sponsor deploys it with $0 in place; anyone can fork the verified contract.</p>
        </div>
      </MainnetOnly>
      <LivePoolView
        cfg={EXAMPLE_POOL}
        initial={initial}
        api="/api/pools/test-match-pool"
        title={EXAMPLE.title}
        by={EXAMPLE.by}
        sub={EXAMPLE.sub}
        example
      />
    </>
  );
}
