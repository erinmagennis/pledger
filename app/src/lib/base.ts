// Base mainnet reads: USDC payment checks and smart-wallet-aware signature checks.
import { createPublicClient, http, getAddress, type Hex, type PublicClient } from "viem";
import { base } from "viem/chains";

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
 * Returns 0n for a reverted tx.
 */
export function sumUsdcTransfersTo(receipt: ReceiptLike, to: string): bigint {
  if (receipt.status !== "success") return 0n;
  const want = to.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  let total = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== BASE_USDC.toLowerCase()) continue;
    const t = log.topics;
    if (t.length !== 3 || t[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (t[2]!.toLowerCase().replace(/^0x/, "") !== want) continue;
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(log.data)) continue;
    total += BigInt(log.data);
  }
  return total;
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
  const amountUnits = sumUsdcTransfersTo(receipt as unknown as ReceiptLike, to);
  if (amountUnits === 0n) return { ok: false, reason: "no-usdc-transfer" };
  const block = await c.getBlock({ blockNumber: receipt.blockNumber });
  return {
    ok: true,
    txHash,
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
