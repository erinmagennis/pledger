// Tempo Moderato testnet facts and helpers for the test match pool.
// Safe to import from server and client code (no secrets here).
import { createPublicClient, erc20Abi, formatUnits, http, type Address, type Hex } from "viem";
import { tempoModerato } from "viem/chains";
import { matchPoolAbi } from "./matchPoolAbi";

export const TEMPO_RPC = "https://rpc.moderato.tempo.xyz";
export const TEMPO_RELAY = "https://sponsor.moderato.tempo.xyz";
export const EXPLORER = "https://explore.testnet.tempo.xyz";

export const MATCH_POOL: Address = "0x02b1364d6d6a4a2a73665591d2083d25e7396a5f";
export const ALPHA_USD: Address = "0x20c0000000000000000000000000000000000001";
export const ALPHA_DECIMALS = 6;
export const RECIPIENT: Address = "0x420ff9871fa9Dc61232356F2c37c7C5E42EC0967";
export const RECIPIENT_LABEL = "Demo project";
export const SPONSOR: Address = "0x5A762ad2E7Bf8e372a7a26b5F6Bb295dCe69fd41";
export const DEPLOY_TX: Hex = "0xe9836e53bb5b58a59c756edd34676dd2586302f4b8ca02b0ec67615d63636d2f";
export const DEPLOY_BLOCK = 39277028n;

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (addr: string) => `${EXPLORER}/address/${addr}`;

export function publicClient() {
  return createPublicClient({ chain: tempoModerato, transport: http(TEMPO_RPC) });
}

/** 6-decimal token units to a number of dollars. */
export function toDollars(units: bigint): number {
  return Number(formatUnits(units, ALPHA_DECIMALS));
}

/** "$5", "$12.50", "$1,000". */
export function usd(units: bigint): string {
  const n = toDollars(units);
  const whole = Number.isInteger(n);
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

export async function alphaBalance(address: Address): Promise<bigint> {
  return publicClient().readContract({ address: ALPHA_USD, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

export { matchPoolAbi };

// ---------- pool data (shape returned by /api/pools/test-match-pool) ----------

export type PoolEvent = {
  kind: "donated" | "deposited";
  tx: string;
  block: number;
  /** unix seconds */
  time: number;
  who: string;
  amount: string;
  match?: string;
  /** raw 6-decimal units as strings, for sums */
  amountUnits: string;
  matchUnits?: string;
};

export type PoolData = {
  pool: string;
  totalDonated: string;
  totalMatched: string;
  totalDeposited: string;
  donationCount: number;
  lockUntil: number;
  poolUnits: string;
  depositedUnits: string;
  matchedUnits: string;
  donatedUnits: string;
  events: PoolEvent[];
  contract: string;
  fetchedAt: number;
};

const LOG_CHUNK = 90_000n;

/** Reads summary() plus all Deposited and Donated logs, newest first. */
export async function readPool(): Promise<PoolData> {
  const c = publicClient();
  const [summary, latest] = await Promise.all([
    c.readContract({ address: MATCH_POOL, abi: matchPoolAbi, functionName: "summary" }),
    c.getBlockNumber(),
  ]);
  const [pool, totalDonated, totalMatched, donationCount, lockUntil] = summary;

  const logs = [];
  for (let from = DEPLOY_BLOCK; from <= latest; from += LOG_CHUNK) {
    const to = from + LOG_CHUNK - 1n < latest ? from + LOG_CHUNK - 1n : latest;
    const chunk = await c.getContractEvents({ address: MATCH_POOL, abi: matchPoolAbi, fromBlock: from, toBlock: to });
    logs.push(...chunk);
  }

  const relevant = logs.filter((l) => l.eventName === "Donated" || l.eventName === "Deposited");
  const blocks = [...new Set(relevant.map((l) => l.blockNumber))];
  const times = new Map<bigint, number>();
  await Promise.all(
    blocks.map(async (b) => {
      const blk = await c.getBlock({ blockNumber: b });
      times.set(b, Number(blk.timestamp));
    }),
  );

  let deposited = 0n;
  const events: PoolEvent[] = [];
  for (const l of relevant) {
    const base = { tx: l.transactionHash, block: Number(l.blockNumber), time: times.get(l.blockNumber) ?? 0 };
    if (l.eventName === "Deposited") {
      const a = l.args as { sponsor: Address; amount: bigint };
      deposited += a.amount;
      events.push({ ...base, kind: "deposited", who: a.sponsor, amount: usd(a.amount), amountUnits: a.amount.toString() });
    } else {
      const a = l.args as { donor: Address; amount: bigint; matchAmount: bigint };
      events.push({
        ...base,
        kind: "donated",
        who: a.donor,
        amount: usd(a.amount),
        match: usd(a.matchAmount),
        amountUnits: a.amount.toString(),
        matchUnits: a.matchAmount.toString(),
      });
    }
  }
  events.sort((x, y) => y.block - x.block);

  return {
    pool: usd(pool),
    totalDonated: usd(totalDonated),
    totalMatched: usd(totalMatched),
    totalDeposited: usd(deposited),
    donationCount: Number(donationCount),
    lockUntil: Number(lockUntil),
    poolUnits: pool.toString(),
    depositedUnits: deposited.toString(),
    matchedUnits: totalMatched.toString(),
    donatedUnits: totalDonated.toString(),
    events,
    contract: MATCH_POOL,
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}

export function shortAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
