// Pledge data for the app. Static facts live here; live numbers are merged in:
// test-match-pool from Tempo testnet (withLivePool), artizen-give-back from the
// Supabase line (withLiveLine), and the home tracker from both (computeTotals).
// Pure: no server imports, safe for client components and tests.
import { fillPerson, formatCents, isExtra, paidFromLine, paymentUnits, shortAddress, type LineEntry, type PaymentRecord } from "./claims";
import zcashTestnetJson from "../content/zcash-pledge.testnet.json";
import zcashMainnetJson from "../content/zcash-pledge.mainnet.json";
import type { Net } from "./network";

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

export type PledgeKind = "matching" | "prize" | "give-back" | "private";
export type Chain = "Tempo testnet" | "Base" | "Zcash testnet" | "Zcash mainnet";

export type Stat = { value: string; label: string };
export type ActivityEntry = { date: string; text: string; amount?: string; href?: string };
export type InPlaceRow = { label: string; value: string; ok?: boolean; href?: string; /** Small line under the row. */ note?: string };

export type Pledge = {
  slug: string;
  kind: PledgeKind;
  title: string;
  /** True for test-money pledges; shows a "Demo" chip everywhere. */
  demo?: boolean;
  /** True for testnet pledges that are not the demo; shows a "Testnet" chip everywhere. */
  testnet?: boolean;
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
  /** Date of a one-time snapshot ("12 Oct 2026"). Set for snapshot pledges; the In place card shows it instead of a live dot. */
  checkedOn?: string;
  howItWorks: string[];
  action: { label: string; href: string };
};

export const KIND_LABEL: Record<PledgeKind, string> = {
  matching: "Matching",
  prize: "Prize",
  "give-back": "Give-back",
  private: "Zcash",
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

// ---------- Artizen give-back: the rule + money in place ----------

export type RuleRow = { label: string; value: string };

/** The give-back rule, set once on 12 Oct 2026. Copy approved by Erin; do not edit after claims open. */
export const ARTIZEN_RULE = {
  rows: [
    { label: "Who pledges", value: "Erin Magennis" },
    { label: "What", value: "50% of any Colosseum prize" },
    { label: "Who gets it", value: "Season 7 backers who paid the 10% endowment fee, in this line" },
    { label: "Order", value: "Self-backers first, then smallest claims first" },
    { label: "When", value: "Payouts start within 14 days of the prize arriving, then weekly until the pledge is used up" },
    { label: "What counts as paid", value: "The full 10% fee, sent in USDC (a US dollar stablecoin) on Base, checked on chain" },
    { label: "Record", value: "Every checked claim and every payment is recorded on Base" },
  ] as RuleRow[],
  setOn: "Set on 12 Oct 2026. Claims open the same day. The rule does not change after that.",
  pledged: "50% of winnings (prize not yet decided)",
  /** Nothing is locked until the prize arrives. */
  inPlaceCents: 0,
} as const;

/** Right column of the rule card: what is pledged, what is in place, and the live line numbers. */
export function moneyRows(st: LineStats, rule: Pick<typeof ARTIZEN_RULE, "pledged" | "inPlaceCents"> = ARTIZEN_RULE): RuleRow[] {
  return [
    { label: "Pledged", value: rule.pledged },
    { label: "In place now", value: formatCents(rule.inPlaceCents) },
    { label: "Paid out so far", value: formatCents(st.paidCents) },
    { label: "People in line", value: String(st.people) },
  ];
}

/** Merge the live line into the Artizen give-back pledge. */
export function withLiveLine(pledge: Pledge, st: LineStats): Pledge {
  return { ...pledge, ...lineFields(st) };
}


// ---------- Zcash: private funder, public money (testnet proof + mainnet pledge) ----------

type ZcashTx = { txid: string; block: number; date: string; amountZat: number; feeZat: number };

/** A static snapshot of one Zcash pledge wallet. The viewing key and address are public by design.
 * Testnet: facts from the viewing-key spike (12 Oct 2026). Mainnet: placeholders (null) until the funder's
 * wallet exists and `published` is true. Every string on the page is derived from this data. */
export type ZcashPledgeData = {
  network: "Zcash testnet" | "Zcash mainnet";
  networkId: Net;
  unit: "TAZ" | "ZEC";
  /** False until the wallet exists and the viewing key is published. Nothing numeric is shown before that. */
  published: boolean;
  /** Shielded pool the funds sit in (mainnet). */
  pool?: string;
  address: string | null;
  addressType: string;
  viewingKey: string | null;
  viewingKeyType: string;
  birthdayHeight: number | null;
  balanceZat: number | null;
  pledgeTx?: ZcashTx & { source?: string };
  outgoingTx?: ZcashTx;
  explorerTxUrl: string;
  explorerShows: string;
  verifiedAt: string | null;
  verifiedBlock: number | null;
  verifiedWith: string;
  indexer: string;
  /** Contains the placeholders <UFVK> (and <BIRTHDAY> on mainnet); use zcashVerifyCommand() for the full command. */
  verifyCommand: string;
  spendCheck: string;
};

/** The testnet JSON predates networkId/published (kept byte-for-byte); fill them from the network name. */
function zcashData(raw: object): ZcashPledgeData {
  const r = raw as Omit<ZcashPledgeData, "networkId" | "published"> & Partial<Pick<ZcashPledgeData, "networkId" | "published">>;
  return { ...r, networkId: r.networkId ?? (r.network === "Zcash mainnet" ? "mainnet" : "testnet"), published: r.published ?? true };
}

export const ZCASH_SLUG = "zcash-private-pledge";
/** The testnet proof (home card and default page). */
export const ZCASH: ZcashPledgeData = zcashData(zcashTestnetJson);
export const ZCASH_MAINNET: ZcashPledgeData = zcashData(zcashMainnetJson);
export const ZCASH_BY_NET: Record<Net, ZcashPledgeData> = { testnet: ZCASH, mainnet: ZCASH_MAINNET };

/** 12_390_000 zat to "0.1239 TAZ" (1 TAZ or ZEC = 100,000,000 zat; trailing zeros dropped). */
export function formatZat(zat: number, unit: string = ZCASH.unit): string {
  const whole = Math.floor(zat / 1e8);
  const frac = String(zat % 1e8).padStart(8, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${frac ? "." + frac : ""} ${unit}`;
}

/** The verify command with the real viewing key (and birthday) in place. */
export function zcashVerifyCommand(d: ZcashPledgeData = ZCASH): string {
  return d.verifyCommand.replace("<UFVK>", d.viewingKey ?? "<UFVK>").replace("<BIRTHDAY>", d.birthdayHeight != null ? String(d.birthdayHeight) : "<BIRTHDAY>");
}

/** The command as shown on the page: key replaced by a short placeholder, birthday filled in. */
export function zcashVerifyDisplay(d: ZcashPledgeData = ZCASH): string {
  return d.verifyCommand.replace("<UFVK>", "<viewing key>").replace("<BIRTHDAY>", d.birthdayHeight != null ? String(d.birthdayHeight) : "<birthday>");
}

/** Risks shown on the mainnet pledge (real money). Approved by Erin, verbatim; block N filled from the snapshot. */
export function zcashMainnetRisks(d: ZcashPledgeData): string[] {
  const block = d.verifiedBlock != null ? d.verifiedBlock.toLocaleString("en-US") : "N";
  return [
    `This is real money (${d.unit}), not test money.`,
    "The viewing key shows every payment in and out of this wallet, the amounts, the memos and the balance, forever. It cannot be taken back.",
    "Memos are readable by anyone with the key. Do not put names or contact details in a memo.",
    "A funder who pays from a transparent (t-) address is visible on the public chain without any key.",
    "If funds went through an exchange, the exchange knows who sent them.",
    "The key cannot spend. Only the wallet seed can, and the funder alone holds it.",
    `No external audit. The balance is a snapshot as of block ${block}, not live.`,
    `Funds sit in Zcash's ${d.pool ?? "Ironwood"} pool, live since 28 Jul 2026.`,
  ];
}

/** "2026-10-12" to "12 Oct 2026". */
function isoDay(iso: string): string {
  return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const shortTx = (tx: string) => tx.slice(0, 6) + "…" + tx.slice(-4);

export function zcashPledge(d: ZcashPledgeData = ZCASH): Pledge {
  const test = d.networkId === "testnet";
  const zat = (n: number) => formatZat(n, d.unit);
  const base = {
    slug: ZCASH_SLUG,
    kind: "private" as const,
    title: "Public money, private funder",
    testnet: test,
    by: { name: "Kept private", initials: "?" },
    chain: d.network,
    action: { label: "Verify it yourself", href: "#verify" },
  };
  const keyLines = [
    "The pledge publishes a viewing key. With it, anyone can see what came in, what went out and what is left.",
    "The key also shows payments going out, including where they went.",
    "The key cannot spend. Only the funder's own wallet can move the money.",
    "Who sent the money stays private. The public explorer shows the fee and nothing else.",
  ];

  // Not published yet (mainnet before the wallet exists): no numbers, no activity.
  if (!d.published || d.balanceZat == null) {
    return {
      ...base,
      stats: [
        { value: "Coming", label: "in place" },
        { value: "Private", label: "funder" },
      ],
      inPlace: [
        { label: "Funder", value: "Private" },
        ...(d.pool ? [{ label: "Pool", value: d.pool }] : []),
        { label: "Chain", value: d.network },
      ],
      activity: [],
      howItWorks: ["The funder sends money to a private Zcash address.", ...keyLines],
    };
  }

  // First use on each surface names the unit in words, never a bare ticker. The balance is a one-time
  // snapshot, not a live read, so its label says so.
  const inPlace = `${zat(d.balanceZat)} (Zcash${test ? " test money" : ""})`;
  const checked = d.verifiedAt ? isoDay(d.verifiedAt) : undefined;
  const activity: ActivityEntry[] = [];
  if (d.outgoingTx) {
    activity.push({
      date: isoDay(d.outgoingTx.date),
      text: `${test ? "Test payment" : "Payment"} out, fee ${zat(d.outgoingTx.feeZat)}`,
      amount: zat(d.outgoingTx.amountZat),
      href: d.explorerTxUrl + d.outgoingTx.txid,
    });
  }
  if (d.pledgeTx) {
    activity.push({
      date: isoDay(d.pledgeTx.date),
      text: test ? "Pledge funded with free test money" : "Pledge funded",
      amount: zat(d.pledgeTx.amountZat),
      href: d.explorerTxUrl + d.pledgeTx.txid,
    });
  }
  const holds = d.pledgeTx
    ? ` This one holds ${zat(d.pledgeTx.amountZat)}${test ? " of free test money from a testnet faucet" : ""}.`
    : "";
  return {
    ...base,
    checkedOn: checked,
    stats: [
      { value: inPlace, label: "in place now (snapshot)" },
      { value: "Private", label: "funder" },
      ...(checked ? [{ value: shortDate(checked), label: "checked" }] : []),
    ],
    cardStats: [
      { value: inPlace, label: "in place now (snapshot)" },
      { value: "Private", label: "funder" },
    ],
    inPlace: [
      { label: "In place now (snapshot)", value: inPlace, ok: true },
      { label: "Funder", value: "Private" },
      ...(d.verifiedBlock != null && checked ? [{ label: "Last verified", value: `Block ${d.verifiedBlock.toLocaleString("en-US")}, ${checked}` }] : []),
      ...(d.pledgeTx
        ? [{ label: "Pledge tx", value: shortTx(d.pledgeTx.txid), href: d.explorerTxUrl + d.pledgeTx.txid, note: "The explorer shows the fee only." }]
        : []),
      ...(d.pool ? [{ label: "Pool", value: d.pool }] : []),
      { label: "Chain", value: d.network },
    ],
    activity,
    howItWorks: [`The funder sends money to a private Zcash address.${holds}`, ...keyLines],
  };
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
  // Third by priority: after the demo pool and the Artizen give-back.
  zcashPledge(),
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
  /** Cumulative cents after each event, oldest first, starting at 0. Same source as the headline:
   * testnet gifts while the demo leads (seriesDemo), real give-backs otherwise. Flat when there are no events. */
  series: number[];
  flat: boolean;
  /** True when the series is test money (the headline leads with the testnet total). */
  seriesDemo: boolean;
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

/** A line entry as the server reads it (claims-server loadLineData): the full payout address and the
 * person's claim fees in claim-time order. Without them the chart falls back to short addresses. */
type TotalsEntry = LineEntry & { address?: string; personFees?: number[] };

export function computeTotals(pool: PoolTotals | null, line: TotalsEntry[], payments: PaymentRecord[]): Totals {
  // Same capped number as the pledge page; raw payments only feed the chart and the feed.
  const paidCents = paidFromLine(line);
  // Extras (sql/005) are shown on the person's row only; they never count toward any total.
  const counted = payments.filter((p) => !isExtra(p));
  const testnetCents = pool ? unitsCents(pool.donatedUnits) + unitsCents(pool.matchedUnits) : 0;

  // One point per event, so a single day of gifts still draws a climb. The chart follows the headline:
  // testnet gifts when the demo leads, real give-backs otherwise; the two are never mixed.
  const realSteps: { t: number; cents: number }[] = [];
  const demoSteps: { t: number; cents: number }[] = [];
  // Give-backs on the chart use the same capped numbers as the headline: each person's payments,
  // in time order, fill their entries (fee cap, forgiveness within the allowance), and a day only gains what that adds.
  // Keyed by full address when the server line carries it, so two people sharing a short address stay apart.
  const full = line.length > 0 && line.every((e) => !!e.address);
  const keyOf = (address: string) => (full ? address.toLowerCase() : shortAddress(address.toLowerCase()));
  const feesBy = new Map<string, number[]>();
  for (const e of line) {
    const k = full ? e.address!.toLowerCase() : e.shortAddress;
    if (e.personFees) feesBy.set(k, e.personFees);
    else feesBy.set(k, [...(feesBy.get(k) ?? []), e.feeCents]);
  }
  const credited = (fees: number[], units: bigint) => fillPerson(fees, units).reduce((s, f) => s + f.paidCents, 0);
  const runUnits = new Map<string, bigint>();
  const runCents = new Map<string, number>();
  for (const p of [...counted].sort((a, b) => Date.parse(a.block_time) - Date.parse(b.block_time))) {
    const who = keyOf(p.to_address);
    const units = (runUnits.get(who) ?? 0n) + paymentUnits(p.amount_units);
    runUnits.set(who, units);
    const cents = credited(feesBy.get(who) ?? [], units);
    realSteps.push({ t: Date.parse(p.block_time), cents: cents - (runCents.get(who) ?? 0) });
    runCents.set(who, cents);
  }
  for (const e of pool?.events ?? []) {
    if (e.kind === "donated") demoSteps.push({ t: e.time * 1000, cents: unitsCents(e.amountUnits) + unitsCents(e.matchUnits) });
  }
  const seriesDemo = testnetCents > 0;
  const steps = (seriesDemo ? demoSteps : realSteps).sort((a, b) => a.t - b.t);
  let run = 0;
  const cumulative = [0, ...steps.map((st) => (run += st.cents))];
  const flat = steps.length === 0;

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
        text: `${shortWho(e.who!)} gave ${e.amount ?? formatCents(unitsCents(e.amountUnits))}`,
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

  return { paidCents, testnetCents, byKind, series: flat ? [0, 0] : cumulative, flat, seriesDemo, people, peopleCount: recent.size, feed };
}

