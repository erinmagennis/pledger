// One view model for every match pool page: the example pledge and pledges made at /make.
// Facts come from the pool's config (set once at deploy) and live chain data (readPool).
// Pure: safe for client components and tests.
import { bpsToRatio, dollars, type PoolConfig } from "./selfserve";
import type { Pledge } from "./pledges";

const EXPLORER = "https://explore.testnet.tempo.xyz";
export const addrHref = (a: string) => `${EXPLORER}/address/${a}`;
export const txHref = (h: string) => `${EXPLORER}/tx/${h}`;

/** The live numbers a pool page reads (subset of tempo.ts PoolData). */
export type LiveNums = {
  poolUnits: string;
  depositedUnits: string;
  matchedUnits: string;
  donatedUnits: string;
  donationCount: number;
  lockUntil: number;
  fetchedAt: number;
  events: { kind: "donated" | "deposited"; tx: string; time: number; who: string; amount: string; match?: string; amountUnits: string; matchUnits?: string }[];
};

const units = (s: string | undefined) => Number(s ?? "0") / 1e6;

export function short(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export function longDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function shortDay(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export type PoolNumbers = {
  /** dollars */
  deposited: number;
  left: number;
  matched: number;
  given: number;
  gifts: number;
  /** 0..1 share of the deposit used as match */
  used: number;
  lockUntil: number;
  /** distinct donors */
  donors: number;
};

/** Numbers for the stat tiles. Without live data, falls back to the configured pool (nothing used yet). */
export function poolNumbers(cfg: PoolConfig, live: LiveNums | null): PoolNumbers {
  if (!live) {
    return { deposited: cfg.poolUsd, left: cfg.poolUsd, matched: 0, given: 0, gifts: 0, used: 0, lockUntil: cfg.lockUntil, donors: 0 };
  }
  const deposited = units(live.depositedUnits);
  const left = units(live.poolUnits);
  const donors = new Set(live.events.filter((e) => e.kind === "donated").map((e) => e.who.toLowerCase())).size;
  return {
    deposited,
    left,
    matched: units(live.matchedUnits),
    given: units(live.donatedUnits),
    gifts: live.donationCount,
    used: deposited > 0 ? Math.min(1, Math.max(0, (deposited - left) / deposited)) : 0,
    lockUntil: live.lockUntil || cfg.lockUntil,
    donors,
  };
}

/** The Pledge shape PledgeHeader needs, for any pool. */
export function headerPledge(cfg: PoolConfig, n: PoolNumbers, opts: { title: string; by: { name: string; initials: string }; demo: boolean }): Pledge {
  return {
    slug: cfg.slug,
    kind: "matching",
    title: opts.title,
    demo: opts.demo,
    testnet: !opts.demo,
    by: opts.by,
    chain: "Tempo testnet",
    stats: [
      { value: dollars(n.left), label: "left to match" },
      { value: dollars(n.matched), label: "matched so far" },
      { value: shortDay(n.lockUntil), label: "in place until" },
    ],
    progress: n.deposited > 0 ? n.used : undefined,
    inPlace: [],
    activity: [],
    howItWorks: [],
    action: { label: "Try it with test money", href: "#try" },
  };
}

export type Step = { icon: "lock" | "heart" | "plus" | "check"; title: string; text: string };

/** Four short steps, true to the contract: deposit locked, gift, match (ratio, cap, while it lasts), both forwarded together. */
export function howSteps(cfg: PoolConfig, n: PoolNumbers): Step[] {
  const ratio = bpsToRatio(cfg.matchBps);
  return [
    { icon: "lock", title: `${dollars(n.deposited || cfg.poolUsd)} set aside`, text: `Locked in the pool until ${longDate(n.lockUntil)}. The funder cannot take it back before then.` },
    { icon: "heart", title: "You give", text: "Any amount, from any wallet." },
    { icon: "plus", title: `Matched ${ratio}`, text: `Up to ${dollars(cfg.capUsd)} of match per donor, while the pool lasts.` },
    { icon: "check", title: "Both arrive together", text: `Your gift and the match go to ${cfg.recipientLabel} in the same transaction.` },
  ];
}

export type FeedItem = {
  key: string;
  kind: "donated" | "deposited";
  who: string;
  initials: string;
  /** 0..4, picks a pastel */
  tone: number;
  title: string;
  match?: string;
  time: number;
  href: string;
};

/** Activity rows for the feed: a short address as the name, a pastel picked from the address. */
export function feed(live: LiveNums | null, cfg: PoolConfig, sponsorLabel: string): FeedItem[] {
  if (!live) return [];
  return live.events.map((e) => {
    const hex = e.who.toLowerCase().replace(/^0x/, "");
    const tone = parseInt(hex.slice(-2) || "0", 16) % 3;
    if (e.kind === "deposited") {
      return { key: e.tx, kind: e.kind, who: sponsorLabel, initials: "", tone: 3, title: `${sponsorLabel} put ${e.amount} in the pool`, time: e.time, href: txHref(e.tx) };
    }
    const matched = e.match && e.match !== "$0" ? e.match : undefined;
    return {
      key: e.tx,
      kind: e.kind,
      who: short(e.who),
      initials: hex.slice(0, 2).toUpperCase(),
      tone,
      title: matched ? `${short(e.who)} gave ${e.amount}` : `${short(e.who)} gave ${e.amount}, match already used`,
      match: matched,
      time: e.time,
      href: txHref(e.tx),
    };
  });
}

/** Facts under the stat tiles, each with a link to check it. */
export function facts(cfg: PoolConfig, n: PoolNumbers): { label: string; value: string; href?: string }[] {
  return [
    { label: "Rule", value: `${bpsToRatio(cfg.matchBps)}, up to ${dollars(cfg.capUsd)} per donor` },
    { label: "Locked until", value: longDate(n.lockUntil) },
    { label: "Goes to", value: cfg.recipientIsDemo || cfg.recipientLabel !== "Recipient" ? `${cfg.recipientLabel} ${short(cfg.recipient)}` : short(cfg.recipient), href: addrHref(cfg.recipient) },
    { label: "Pool contract", value: short(cfg.address), href: addrHref(cfg.address) },
  ];
}

/** The example pledge on /pledges/demo: the first pool, deployed before /make existed.
 * Written as if real; the page says once, at the top, that it is an example with test money. */
export const EXAMPLE = {
  title: "Double every gift to the Riverside Seed Library",
  by: { name: "Riverside Neighbors Fund", initials: "RN" },
  sub: "The fund matches each gift to the library, dollar for dollar, so it can stock seeds for spring planting.",
};

export const EXAMPLE_POOL: PoolConfig = {
  slug: "demo",
  address: "0x02b1364d6d6a4a2a73665591d2083d25e7396a5f",
  name: EXAMPLE.title,
  poolUsd: 500,
  matchBps: 10_000,
  capUsd: 20,
  lockUntil: Date.UTC(2026, 11, 31, 23, 59, 59) / 1000,
  recipient: "0x420ff9871fa9Dc61232356F2c37c7C5E42EC0967",
  recipientLabel: "Riverside Seed Library",
  recipientIsDemo: true,
  sponsor: "0x5A762ad2E7Bf8e372a7a26b5F6Bb295dCe69fd41",
  deployTx: "0xe9836e53bb5b58a59c756edd34676dd2586302f4b8ca02b0ec67615d63636d2f",
  deployBlock: 39277028,
};
