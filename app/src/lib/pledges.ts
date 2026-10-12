// Pledge data for the app.
// TODO(data): everything here is SAMPLE DATA copied from design/home-v3.html.
// Wire to Tempo (MatchPool contract reads) and Supabase (claims, activity log)
// before launch. Keep the exported types stable so pages do not change.

export type PledgeKind = "matching" | "prize" | "give-back";
export type Chain = "Tempo testnet" | "Base";

export type Stat = { value: string; label: string };
export type ActivityEntry = { date: string; text: string; amount?: string };
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
    slug: "test-match-pool",
    kind: "matching",
    title: "Test match pool",
    by: { name: "Pledger demo", initials: "PL" },
    chain: "Tempo testnet",
    stats: [
      { value: "$500", label: "in place" },
      { value: "$120", label: "matched" },
      { value: "31 Dec", label: "in place until" },
    ],
    progress: 0.24,
    inPlace: [
      { label: "Match in place", value: "$500", ok: true },
      { label: "In place until", value: "31 December 2026" },
      { label: "Matched so far", value: "$120" },
      { label: "Left to match", value: "$380" },
      { label: "Chain", value: "Tempo testnet" },
    ],
    activity: [
      { date: "12 Oct 2026", text: "Donation matched for A. O.", amount: "$40" },
      { date: "10 Oct 2026", text: "Donation matched for M. R.", amount: "$50" },
      { date: "8 Oct 2026", text: "Donation matched for T. P.", amount: "$30" },
      { date: "6 Oct 2026", text: "Match of $500 put in place", amount: "$500" },
    ],
    howItWorks: [
      "The $500 match is locked until 31 December 2026. It cannot be taken back before then.",
      "Each donation is matched up to a set ratio and a cap per donor.",
      "Donation and match go to the recipient together, with a receipt.",
    ],
    action: { label: "Try it with test money", href: "/claim" },
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
