// Pledge data for the app.
// TODO(data): everything here is SAMPLE DATA copied from design/home-v3.html,
// except test-match-pool, which is live from Tempo testnet (withLivePool).
// Wire to Tempo (MatchPool contract reads) and Supabase (claims, activity log)
// before launch. Keep the exported types stable so pages do not change.

export type PledgeKind = "matching" | "prize" | "give-back";
export type Chain = "Tempo testnet" | "Base";

export type Stat = { value: string; label: string };
export type ActivityEntry = { date: string; text: string; amount?: string; href?: string };
export type InPlaceRow = { label: string; value: string; ok?: boolean };

export type Pledge = {
  slug: string;
  kind: PledgeKind;
  title: string;
  by: { name: string; initials: string };
  chain: Chain;
  /** Short stats for cards and the pledge header (2 or 3). */
  stats: Stat[];
  /** 0 to 1, drives the progress bar. Omit to hide the bar. */
  progress?: number;
  inPlace: InPlaceRow[];
  activity: ActivityEntry[];
  howItWorks: string[];
  action: { label: string; href: string };
};

export const KIND_LABEL: Record<PledgeKind, string> = {
  matching: "Matching",
  prize: "Prize",
  "give-back": "Give-back",
};

const pledges: Pledge[] = [
  {
    // Static facts only. Live numbers and activity come from Tempo via
    // withLivePool() below (see src/lib/tempo.ts readPool()).
    slug: "test-match-pool",
    kind: "matching",
    title: "Test match pool",
    by: { name: "Pledger demo", initials: "PL" },
    chain: "Tempo testnet",
    stats: [
      { value: "$500", label: "put in place" },
      { value: "1:1", label: "match, up to $20 each" },
      { value: "31 Dec", label: "in place until" },
    ],
    inPlace: [
      { label: "Match put in place", value: "$500", ok: true },
      { label: "Match rule", value: "1:1, up to $20 per wallet" },
      { label: "In place until", value: "31 December 2026" },
      { label: "Goes to", value: "Demo project" },
      { label: "Chain", value: "Tempo testnet" },
    ],
    activity: [],
    howItWorks: [
      "The $500 match is locked until 31 December 2026. It cannot be taken back before then.",
      "Each donation is matched 1:1, up to $20 per wallet.",
      "Donation and match go to Demo project together, in the same transaction.",
    ],
    action: { label: "Try it with test money", href: "#try" },
  },
  {
    slug: "artizen-give-back",
    kind: "give-back",
    title: "Get your Artizen 10% back",
    by: { name: "Erin Magennis", initials: "EM" },
    chain: "Base",
    stats: [
      { value: "50%", label: "of her winnings" },
      { value: "41", label: "in line" },
      { value: "20 Oct", label: "next update" },
    ],
    inPlace: [
      { label: "Share pledged", value: "50% of Colosseum winnings", ok: true },
      { label: "Who can claim", value: "People who paid the 10% fee" },
      { label: "Claims in line", value: "41" },
      { label: "Chain", value: "Base" },
    ],
    activity: [
      { date: "12 Oct 2026", text: "Claims open" },
      { date: "11 Oct 2026", text: "Pledge made: 50% of winnings" },
    ],
    howItWorks: [
      "Send in your Artizen receipt email. Pledger checks its signature, so no screenshots.",
      "Each receipt can be claimed once.",
      "Payments go out on Base, and each one is recorded in public.",
    ],
    action: { label: "Check or add your claim", href: "/claim" },
  },
];

/** Live pool numbers for the test match pool (shape of /api/pools/test-match-pool). */
export type LivePool = {
  pool: string;
  totalDonated: string;
  totalMatched: string;
  totalDeposited: string;
  donationCount: number;
  poolUnits: string;
  depositedUnits: string;
  events: { kind: "donated" | "deposited"; tx: string; time: number; who: string; amount: string; match?: string }[];
};

const TX_URL = "https://explore.testnet.tempo.xyz/tx/";

function dateLabel(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function shortWho(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

/** Merge live Tempo data into the test match pool pledge. */
export function withLivePool(pledge: Pledge, live: LivePool): Pledge {
  const deposited = Number(live.depositedUnits);
  const left = Number(live.poolUnits);
  const progress = deposited > 0 ? Math.min(1, Math.max(0, (deposited - left) / deposited)) : undefined;
  return {
    ...pledge,
    stats: [
      { value: live.pool, label: "left to match" },
      { value: live.totalMatched, label: "matched" },
      { value: "31 Dec", label: "in place until" },
    ],
    progress,
    inPlace: [
      { label: "Pool left", value: live.pool, ok: true },
      { label: "Matched so far", value: live.totalMatched },
      { label: "Donated so far", value: live.totalDonated },
      { label: "Donations", value: String(live.donationCount) },
      { label: "In place until", value: "31 December 2026" },
      { label: "Chain", value: "Tempo testnet" },
    ],
    activity: live.events.map((e) =>
      e.kind === "deposited"
        ? { date: dateLabel(e.time), text: `Match of ${e.amount} put in place`, amount: e.amount, href: TX_URL + e.tx }
        : {
            date: dateLabel(e.time),
            text: e.match === "$0" ? `${shortWho(e.who)} gave ${e.amount}, match used up` : `${shortWho(e.who)} gave ${e.amount}, matched ${e.match}`,
            amount: e.amount,
            href: TX_URL + e.tx,
          },
    ),
  };
}

export function getPledges(): Pledge[] {
  return pledges;
}

export function getPledge(slug: string): Pledge | undefined {
  return pledges.find((p) => p.slug === slug);
}

export type Totals = {
  paidOut: number;
  peoplePaid: number;
  byKind: { kind: PledgeKind; label: string; amount: number }[];
  /** Cumulative payout points for the sparkline, oldest first. */
  series: number[];
  recentPeople: string[];
};

// TODO(data): sample numbers from the design. Replace with sums of verified
// payments from Tempo + Base (via Supabase index).
export function getTotals(): Totals {
  return {
    paidOut: 2340,
    peoplePaid: 31,
    byKind: [
      { kind: "matching", label: "Matching", amount: 1170 },
      { kind: "prize", label: "Prizes", amount: 700 },
      { kind: "give-back", label: "Give-backs", amount: 470 },
    ],
    series: [4, 6, 10, 12, 20, 24, 38, 44, 60, 68, 82],
    recentPeople: ["MR", "AO", "TP"],
  };
}

export function formatUsd(n: number): string {
  return "$" + n.toLocaleString("en-US");
}
