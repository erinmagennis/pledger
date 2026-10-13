// A pledge made at /make: a MatchPool on Tempo testnet, found by its link only (never listed on the home page).
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Address } from "viem";
import { Icon } from "@/components/Icons";
import { LivePoolView } from "@/components/demo/LivePoolView";
import { ShareLink } from "@/components/selfserve/ShareLink";
import { MainnetOnly } from "@/components/NetSwitch";
import { EXAMPLE_POOL } from "@/lib/poolview";
import { getSelfServe } from "@/lib/selfserve-server";
import { ruleLine, type PoolConfig } from "@/lib/selfserve";
import { readPool, type PoolData } from "@/lib/tempo";
import "@/styles/selfserve.css";

export const dynamic = "force-dynamic";

type Params = { slug: string };

/** Local preview only (never in production): a made-up pledge on the example pool, for screenshots without a database. */
const PREVIEW_SLUG = "preview-sample-000000";
function preview(slug: string): PoolConfig | null {
  if (process.env.NODE_ENV === "production" || slug !== PREVIEW_SLUG) return null;
  return { ...EXAMPLE_POOL, slug, name: "Spring match for the Eastside Tool Library", recipientLabel: "Test project" };
}

async function load(slug: string): Promise<PoolConfig | null> {
  return preview(slug) ?? (await getSelfServe(slug));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const cfg = await load((await params).slug);
  return { title: cfg ? `${cfg.name} · Pledger` : "Pledge not found · Pledger", robots: { index: false } };
}

export default async function SelfServePledgePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const cfg = await load(slug);
  if (!cfg) notFound();
  let initial: PoolData | null = null;
  try {
    initial = await readPool(cfg.address as Address, BigInt(cfg.deployBlock));
  } catch {
    initial = null;
  }
  const isPreview = slug === PREVIEW_SLUG;
  return (
    <>
      <Link className="back" href="/make"><Icon name="arrow" small />Make your own</Link>
      <MainnetOnly>
        <div className="card net-note">
          <span className="k"><span className="live still" />Mainnet</span>
          <p>Self-serve pledges run on testnet for now. Mainnet is next.</p>
        </div>
      </MainnetOnly>
      <LivePoolView
        cfg={cfg}
        initial={initial}
        api={isPreview ? "/api/pools/test-match-pool" : `/api/pledges/p/${slug}/pool`}
        title={cfg.name}
        by={{ name: "a Pledger visitor", initials: "PV" }}
        sub={`${ruleLine(cfg)}. Made with Pledger in about a minute.`}
        example={false}
        extra={<ShareLink path={`/pledges/p/${slug}`} />}
      />
    </>
  );
}
