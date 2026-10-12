// Base mainnet reads: USDC payment checks and smart-wallet-aware signature checks.
import { createPublicClient, http, getAddress, type Hex, type PublicClient } from "viem";
import { base } from "viem/chains";
import { allowanceUnits } from "./claims";

/** Native USDC on Base mainnet. */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const BASE_CHAIN_ID = 8453;
/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const USDC_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export const BASESCAN_TX = "https://basescan.org/tx/";

let client: PublicClient | undefined;

export function baseClient(): PublicClient {
  client ??= createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
  }) as PublicClient;
  return client;
}

export type ReceiptLike = {
  status: "success" | "reverted" | string;
  blockNumber: bigint | string | number;
  logs: Array<{ address: string; topics: readonly string[] | string[]; data: string }>;
};

/**
 * Sum native USDC Transfer logs to `to` in a receipt. Multiple matching logs (batch payouts) are added.
 * Logs sent from `to` itself are counted apart in selfUnits and never as a payment.
 * Returns zeros for a reverted tx.
 */
export function usdcTransfersTo(receipt: ReceiptLike, to: string): { units: bigint; selfUnits: bigint } {
  if (receipt.status !== "success") return { units: 0n, selfUnits: 0n };
  const want = to.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  let units = 0n;
  let selfUnits = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== BASE_USDC.toLowerCase()) continue;
    const t = log.topics;
    if (t.length !== 3 || t[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (t[2]!.toLowerCase().replace(/^0x/, "") !== want) continue;
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(log.data)) continue;
    if (t[1]!.toLowerCase().replace(/^0x/, "") === want) selfUnits += BigInt(log.data);
    else units += BigInt(log.data);
  }
  return { units, selfUnits };
}

/** USDC paid to `to` by anyone other than `to`. */
export function sumUsdcTransfersTo(receipt: ReceiptLike, to: string): bigint {
  return usdcTransfersTo(receipt, to).units;
}

/** ISO time to ms. Postgres gives microseconds, so keep only the first 3 fraction digits. */
const toMs = (iso: string) => Date.parse(iso.replace(/(\.\d{3})\d+/, "$1"));

/** "$12.50" with cents always shown. */
export const dollars = (units: bigint) => "$" + (Number(units / 10_000n) / 100).toFixed(2);

/**
 * The payment rule: a payment counts only if it was sent after the person's first claim
 * and is their full remaining amount, within 0.9% either way, the allowance capped at $1.00 (allowanceUnits).
 * (Self-transfers are dropped before this.)
 */
export const SENT_BEFORE = "Sent before this claim was made";

export function checkPaymentRule(args: { blockTime: string; firstClaimAt: string; amountUnits: bigint; owedUnits: bigint }): { ok: true } | { ok: false; error: string } {
  if (!(toMs(args.blockTime) > toMs(args.firstClaimAt))) return { ok: false, error: SENT_BEFORE };
  const { amountUnits: a, owedUnits: o } = args;
  const allow = allowanceUnits(o);
  if (o <= 0n || a < o - allow || a > o + allow) return { ok: false, error: `Does not match what is owed (${dollars(o > 0n ? o : 0n)})` };
  return { ok: true };
}

/** Accept a bare hash or a Basescan-style link. */
export function parseTxHash(input: string): Hex | null {
  const m = input.trim().match(/0x[0-9a-fA-F]{64}/);
  return m ? (m[0].toLowerCase() as Hex) : null;
}

export type CheckedPayment = { ok: true; txHash: Hex; to: string; amountUnits: bigint; blockNumber: bigint; blockTime: string } | { ok: false; reason: string };

export async function checkUsdcPayment(txHash: Hex, to: string, c: PublicClient = baseClient()): Promise<CheckedPayment> {
  let receipt;
  try {
    receipt = await c.getTransactionReceipt({ hash: txHash });
  } catch {
    return { ok: false, reason: "tx-not-found" };
  }
  if (receipt.status !== "success") return { ok: false, reason: "tx-failed" };
  const { units: amountUnits, selfUnits } = usdcTransfersTo(receipt as unknown as ReceiptLike, to);
  if (amountUnits === 0n) return { ok: false, reason: selfUnits > 0n ? "self-transfer" : "no-usdc-transfer" };
  const block = await c.getBlock({ blockNumber: receipt.blockNumber });
  return {
    ok: true,
    txHash: txHash.toLowerCase() as Hex,
    to: getAddress(to).toLowerCase(),
    amountUnits,
    blockNumber: receipt.blockNumber,
    blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
  };
}

/** EOA, ERC-1271 and ERC-6492 (undeployed smart wallet) signatures. */
export async function verifyOnBase(args: { address: `0x${string}`; message: string; signature: `0x${string}` }): Promise<boolean> {
  return baseClient().verifyMessage(args);
}
