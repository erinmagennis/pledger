// Pledge data for the app. Static facts live here; live numbers are merged in:
// test-match-pool from Tempo testnet (withLivePool), artizen-give-back from the
// Supabase line (withLiveLine), and the home tracker from both (computeTotals).
// Pure: no server imports, safe for client components and tests.
import { fillPerson, formatCents, isExtra, paidFromLine, paymentUnits, shortAddress, type LineEntry, type PaymentRecord } from "./claims";

// Tempo testnet addresses (same values as src/lib/tempo.ts; kept here so this file stays import-light).
const TEMPO_EXPLORER = "https://explore.testnet.tempo.xyz";
const POOL_ADDRESS = "0x02b1364d6d6a4a2a73665591d2083d25e7396a5f";
const DEMO_PROJECT = "0x420ff9871fa9Dc61232356F2c37c7C5E42EC0967";
const BASESCAN_TX = "https://basescan.org/tx/";
const addrRow = (label: string, value: string, addr: string): InPlaceRow => ({ label, value, href: `${TEMPO_EXPLORER}/address/${addr}` });
const POOL_ROWS: InPlaceRow[] = [
  addrRow("Goes to", `Demo project ${shortWho(DEMO_PROJECT)}`, DEMO_PROJECT),
  addrRow("Pool contract", shortWho(POOL_ADDRESS), POOL_ADDRESS),
];

export type PledgeKind = "matching" | "prize" | "give-back";
export type Chain = "Tempo testnet" | "Base";

export type Stat = { value: string; label: string };
export type ActivityEntry = { date: string; text: string; amount?: string; href?: string };
export type InPlaceRow = { label: string; value: string; ok?: boolean; href?: string };

export type Pledge = {
  slug: string;
  kind: PledgeKind;
  title: string;
  /** True for test-money pledges; shows a "Demo" chip everywhere. */
  demo?: boolean;
  by: { name: string; initials: string };
  chain: Chain;
  /** Short stats for the pledge header, and for cards when cardStats is not set (2 or 3). */
  stats: Stat[];
  /** Stats for the home page card, when they differ from the header. */
  cardStats?: Stat[];
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

/** "20 October 2026" to "20 Oct". */
export function shortDate(long: string): string {
  const [day, month] = long.split(" ");
  return day && month ? `${day} ${month.slice(0, 3)}` : long;
}

export type LineStats = { people: number; feesCents: number; paidCents: number };

/** People in line (unique payout addresses), fees claimed and paid from the line. */
export function lineStats(line: LineEntry[]): LineStats {
  return {
    people: new Set(line.map((e) => e.pid)).size,
    feesCents: line.reduce((s, e) => s + e.feeCents, 0),
    paidCents: paidFromLine(line),
  };
}

function lineFields(st: LineStats): Pick<Pledge, "stats" | "cardStats" | "inPlace"> {
  return {
    stats: [
      { value: String(st.people), label: "in line" },
      { value: formatCents(st.feesCents), label: "fees claimed" },
      { value: formatCents(st.paidCents), label: "paid so far" },
    ],
    cardStats: [
      { value: String(st.people), label: "in line" },
      { value: formatCents(st.feesCents), label: "fees claimed" },
      { value: formatCents(st.paidCents), label: "paid from the line" },
    ],
    inPlace: [
      { label: "Share pledged", value: "50% of Colosseum winnings", ok: true },
      { label: "Who can claim", value: "People who paid the 10% fee" },
      { label: "People in line", value: String(st.people) },
      { label: "Fees claimed", value: formatCents(st.feesCents) },
      { label: "Paid from the line", value: formatCents(st.paidCents) },
      { label: "Chain", value: "Base" },
    ],
  };
}

/** Merge the live line into the Artizen give-back pledge. */
export function withLiveLine(pledge: Pledge, st: LineStats): Pledge {
  return { ...pledge, ...lineFields(st) };
}

const pledges: Pledge[] = [
  {
    // Static facts only. Live numbers and activity come from Tempo via
    // withLivePool() below (see src/lib/tempo.ts readPool()).
    slug: "test-match-pool",
    kind: "matching",
    title: "Demo match pool",
    demo: true,
    by: { name: "Pledger demo", initials: "PL" },
    chain: "Tempo testnet",
    stats: [
      { value: "$500", label: "put in place" },
      { value: "1:1", label: "match, up to $20 each" },
      { value: "31 Dec", label: "in place until" },
    ],
    inPlace: [
      { label: "Match put in place", value: "$500", ok: true },
      { label: "Match rule", value: "1:1, up to $20 per visitor" },
      { label: "In place until", value: "31 December 2026" },
      ...POOL_ROWS,
      { label: "Chain", value: "Tempo testnet" },
    ],
    activity: [],
    howItWorks: [
      "The $500 match is locked until 31 December 2026. It cannot be taken back before then.",
      "Each donation is matched 1:1, up to $20 per visitor.",
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
    // Zeros until withLiveLine() merges the real line (also the fallback when the database is not connected).
    ...lineFields({ people: 0, feesCents: 0, paidCents: 0 }),
    activity: [
      { date: "12 Oct 2026", text: "Claims open" },
      { date: "11 Oct 2026", text: "Pledge made" },
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

const TX_URL = TEMPO_EXPLORER + "/tx/";

function dateLabel(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function shortWho(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

/** "Visitor 0xcb8b…8D7F": testnet donors are people trying the demo. */
function visitor(a: string): string {
  return `Visitor ${shortWho(a)}`;
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
      ...POOL_ROWS,
      { label: "Chain", value: "Tempo testnet" },
    ],
    activity: live.events.map((e) =>
      e.kind === "deposited"
        ? { date: dateLabel(e.time), text: `Match of ${e.amount} put in place`, amount: e.amount, href: TX_URL + e.tx }
        : {
            date: dateLabel(e.time),
            text: e.match === "$0" ? `${visitor(e.who)} gave ${e.amount}, this visitor’s $20 match was already used` : `${visitor(e.who)} gave ${e.amount}, matched ${e.match}`,
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

export function formatUsd(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

// ---------- home tracker ----------

export type Totals = {
  /** Real Base mainnet payments recorded for the give-back (pledger_payments). */
  paidCents: number;
  /** Testnet sends in the demo: donated plus matched. */
  testnetCents: number;
  byKind: { kind: PledgeKind; label: string; cents: number }[];
  /** Cumulative cents by day, oldest first. Flat when there are fewer than 2 days. */
  series: number[];
  flat: boolean;
  /** Initials for the most recent people in line (max 3). */
  people: string[];
  peopleCount: number;
  /** Latest 3 events across pledges, newest first (testnet gifts and give-back payments). */
  feed: FeedItem[];
};

export type FeedItem = {
  /** 2-letter avatar text, or null to show the give-back icon. */
  av: string | null;
  text: string;
  /** unix seconds */
  time: number;
  testnet: boolean;
  href: string;
};

/** Minimal shape of the pool data the tracker needs (see PoolData in tempo.ts). */
export type PoolTotals = {
  donatedUnits: string;
  matchedUnits: string;
  events: { kind: "donated" | "deposited"; time: number; amountUnits: string; matchUnits?: string; tx?: string; who?: string; amount?: string }[];
};

const unitsCents = (u: string | number | undefined) => Number(BigInt(String(u ?? "0").split(".")[0] || "0") / 10_000n);

/** "Ana Ortiz" or "A. O." to "AO"; a project name works the same way. */
export function avatarInitials(label: string): string {
  const letters = label
    .split(/[\s.,]+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .map((w) => w.match(/[\p{L}\p{N}]/u)![0]!.toUpperCase());
  return letters.slice(0, 2).join("") || "?";
}

export function computeTotals(pool: PoolTotals | null, line: LineEntry[], payments: PaymentRecord[]): Totals {
  // Same capped number as the pledge page; raw payments only feed the chart and the feed.
  const paidCents = paidFromLine(line);
  // Extras (sql/005) are shown on the person's row only; they never count toward any total.
  const counted = payments.filter((p) => !isExtra(p));
  const testnetCents = pool ? unitsCents(pool.donatedUnits) + unitsCents(pool.matchedUnits) : 0;

  const byDay = new Map<string, number>();
  const add = (iso: string, cents: number) => {
    const day = iso.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + cents);
  };
  // Give-backs on the chart use the same capped numbers as the headline: each person's payments,
  // in time order, fill their entries (fee cap, 99.5% forgiveness), and a day only gains what that adds.
  const feesBy = new Map<string, number[]>();
  for (const e of line) feesBy.set(e.shortAddress, [...(feesBy.get(e.shortAddress) ?? []), e.feeCents]);
  const credited = (fees: number[], units: bigint) => fillPerson(fees, units).reduce((s, f) => s + f.paidCents, 0);
  const runUnits = new Map<string, bigint>();
  const runCents = new Map<string, number>();
  for (const p of [...counted].sort((a, b) => Date.parse(a.block_time) - Date.parse(b.block_time))) {
    const who = shortAddress(p.to_address.toLowerCase());
    const units = (runUnits.get(who) ?? 0n) + paymentUnits(p.amount_units);
    runUnits.set(who, units);
    const cents = credited(feesBy.get(who) ?? [], units);
    add(new Date(p.block_time).toISOString(), cents - (runCents.get(who) ?? 0));
    runCents.set(who, cents);
  }
  for (const e of pool?.events ?? []) {
    if (e.kind === "donated") add(new Date(e.time * 1000).toISOString(), unitsCents(e.amountUnits) + unitsCents(e.matchUnits));
  }
  const days = [...byDay.keys()].sort();
  let run = 0;
  const cumulative = days.map((d) => (run += byDay.get(d)!));
  const flat = cumulative.length < 2;

  const recent = new Map<string, { at: string; label: string }>();
  for (const e of line) {
    const cur = recent.get(e.pid);
    if (!cur || e.firstAt > cur.at) recent.set(e.pid, { at: e.firstAt, label: e.label });
  }
  const people = [...recent.values()]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 3)
    .map((p) => avatarInitials(p.label));

  const byKind = (
    [
      { kind: "matching", label: "Demo match pool (test money)", cents: testnetCents },
      { kind: "give-back", label: "Give-backs", cents: paidCents },
    ] as Totals["byKind"]
  ).filter((k) => k.cents > 0);

  const feed: FeedItem[] = [
    ...(pool?.events ?? [])
      .filter((e) => e.kind === "donated" && e.tx && e.who)
      .map((e) => ({
        av: e.who!.slice(2, 4).toUpperCase(),
        text: `A visitor gave ${e.amount ?? formatCents(unitsCents(e.amountUnits))}`,
        time: e.time,
        testnet: true,
        href: TX_URL + e.tx,
      })),
    ...counted.map((p) => ({
      av: null,
      text: `Give-back of ${formatCents(unitsCents(p.amount_units))} paid`,
      time: Math.floor(new Date(p.block_time).getTime() / 1000),
      testnet: false,
      href: BASESCAN_TX + p.tx_hash,
    })),
  ]
    .sort((a, b) => b.time - a.time)
    .slice(0, 3);

  return { paidCents, testnetCents, byKind, series: flat ? [0, 0] : cumulative, flat, people, peopleCount: recent.size, feed };
}

