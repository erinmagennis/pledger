// Browser-side donation flow for the "Try it" demo.
// Throwaway key, approve + donate, fee paid by Tempo's public sponsor relay.
// If the relay fails, retry once paying the fee in AlphaUSD (feeToken).
import { createClient, erc20Abi, http, parseEventLogs, parseUnits, publicActions, toHex, walletActions, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempoModerato } from "viem/chains";
import { tempoActions, withRelay } from "viem/tempo";
import { ALPHA_USD, MATCH_POOL, TEMPO_RELAY, TEMPO_RPC, matchPoolAbi } from "@/lib/tempo";

export type GiveStep = "approving" | "donating";

export type GiveResult = {
  approveTx?: Hex;
  donateTx: Hex;
  amountUnits: bigint;
  matchUnits: bigint;
  sponsored: boolean;
  who: Hex;
  time: number;
  block: number;
};

const validBefore = () => Math.floor(Date.now() / 1000) + 240;

function clientFor(key: Hex, sponsored: boolean) {
  const account = privateKeyToAccount(key);
  const transport = sponsored ? withRelay(http(TEMPO_RPC), http(TEMPO_RELAY)) : http(TEMPO_RPC);
  return createClient({ account, chain: tempoModerato, transport })
    .extend(publicActions)
    .extend(walletActions)
    .extend(tempoActions());
}

async function run(key: Hex, dollars: number, sponsored: boolean, onStep: (s: GiveStep) => void): Promise<GiveResult> {
  const c = clientFor(key, sponsored);
  const who = c.account.address;
  const amount = parseUnits(String(dollars), 6);
  const fee = sponsored ? { feePayer: true as const } : { feeToken: ALPHA_USD };

  let approveTx: Hex | undefined;
  const allowance = await c.readContract({ address: ALPHA_USD, abi: erc20Abi, functionName: "allowance", args: [who, MATCH_POOL] });
  if (allowance < amount) {
    onStep("approving");
    approveTx = await c.writeContract({
      address: ALPHA_USD,
      abi: erc20Abi,
      functionName: "approve",
      args: [MATCH_POOL, amount],
      // A wallet's first self-paid tx costs about 530k gas (account setup), so allow more without the relay.
      gas: sponsored ? 500_000n : 1_000_000n,
      validBefore: validBefore(),
      ...fee,
    });
    const r = await c.waitForTransactionReceipt({ hash: approveTx });
    if (r.status !== "success") throw new Error("The approval did not go through.");
  }

  onStep("donating");
  const memo = toHex("pledger-demo-" + who.slice(2, 8).toLowerCase() + Math.random().toString(36).slice(2, 6), { size: 32 });
  const donateTx = await c.writeContract({
    address: MATCH_POOL,
    abi: matchPoolAbi,
    functionName: "donate",
    args: [amount, memo],
    gas: 3_000_000n,
    validBefore: validBefore(),
    ...fee,
  });
  const receipt = await c.waitForTransactionReceipt({ hash: donateTx });
  if (receipt.status !== "success") throw new Error("The gift did not go through.");
  const [ev] = parseEventLogs({ abi: matchPoolAbi, logs: receipt.logs, eventName: "Donated" });
  const block = await c.getBlock({ blockNumber: receipt.blockNumber });
  return {
    approveTx,
    donateTx,
    amountUnits: ev ? ev.args.amount : amount,
    matchUnits: ev ? ev.args.matchAmount : 0n,
    sponsored,
    who,
    time: Number(block.timestamp),
    block: Number(receipt.blockNumber),
  };
}

export async function give(key: Hex, dollars: number, onStep: (s: GiveStep) => void): Promise<GiveResult> {
  try {
    return await run(key, dollars, true, onStep);
  } catch (first) {
    console.warn("Sponsored send failed, retrying with fee in AlphaUSD", first);
    return run(key, dollars, false, onStep);
  }
}

export async function balanceOf(address: Hex): Promise<bigint> {
  const c = createClient({ chain: tempoModerato, transport: http(TEMPO_RPC) }).extend(publicActions);
  return c.readContract({ address: ALPHA_USD, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}
