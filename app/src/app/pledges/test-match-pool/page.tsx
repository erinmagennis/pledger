import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Icon } from "@/components/Icons";
import { LivePoolView } from "@/components/demo/LivePoolView";
import { getPledge } from "@/lib/pledges";
import { readPool, type PoolData } from "@/lib/tempo";

// Live pool data from Tempo testnet, refreshed about every 10 seconds.
export const revalidate = 10;

export const metadata: Metadata = { title: "Test match pool · Pledger" };

export default async function TestMatchPoolPage() {
  const base = getPledge("test-match-pool");
  if (!base) notFound();
  let initial: PoolData | null = null;
  try {
    initial = await readPool();
  } catch {
    initial = null; // the client view retries from /api/pools/test-match-pool
  }
  return (
    <>
      <Link className="back" href="/#live"><Icon name="arrow" small />All pledges</Link>
      <LivePoolView base={base} initial={initial} />
    </>
  );
}
