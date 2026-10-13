// Deploy and fund one MatchPool on Tempo Moderato testnet for a self-serve pledge.
// Each pledge gets its own sponsor wallet: a fresh key made here, funded by Tempo's public test
// faucet (the same one the Try it demo uses), used for three transactions and then dropped.
// Nothing secret is configured or stored, and parallel creates never share a nonce.
// The cost: nobody can call withdrawRemainder() after the lock, so unused test money stays in the pool.
// Relative imports only, so a dry-run script can load this file outside Next.
import {
  createClient,
  encodeDeployData,
  erc20Abi,
  http,
  publicActions,
  walletActions,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { tempoModerato } from "viem/chains";
import { tempoActions } from "viem/tempo";
import { matchPoolAbi } from "./matchPoolAbi";
import { MATCH_POOL_BYTECODE } from "./matchPoolBytecode";
import { ratioToBps, toUnits, type PledgeInput } from "./selfserve";

const RPC = "https://rpc.moderato.tempo.xyz";
const ALPHA: Address = "0x20c0000000000000000000000000000000000001";
/** Left over for fees after the deposit (three transactions, the first sets up the account). */
const FEE_ROOM = 2_000_000n;

export type Deployed = {
  address: Address;
  sponsor: Address;
  deployTx: Hex;
  approveTx: Hex;
  depositTx: Hex;
  deployBlock: number;
  recipient: Address;
};

export type Step = "funding" | "deploying" | "depositing";

const validBefore = () => Math.floor(Date.now() / 1000) + 240;

async function faucet(address: Address, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tempo_fundAddress", params: [address] }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`The Tempo test faucet answered with status ${res.status}.`);
  const j = (await res.json()) as { error?: { message?: string } };
  if (j.error) throw new Error(`The Tempo test faucet said: ${j.error.message ?? "unknown error"}.`);
}

/** Deploys MatchPool(token, sponsor, recipient, matchBps, cap, lockUntil, name), then approves and deposits the pool. */
export async function deployAndFund(
  input: PledgeInput,
  recipient: Address,
  opts: { fetchImpl?: typeof fetch; onStep?: (s: Step) => void; maxFaucetCalls?: number } = {},
): Promise<Deployed> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const account = privateKeyToAccount(generatePrivateKey());
  const c = createClient({ account, chain: tempoModerato, transport: http(RPC) })
    .extend(publicActions)
    .extend(walletActions)
    .extend(tempoActions());
  const amount = toUnits(input.poolUsd);
  const need = amount + FEE_ROOM;
  const balance = () => c.readContract({ address: ALPHA, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });

  // 1. Test money from the faucet, asking again if one round is not enough for the pool.
  opts.onStep?.("funding");
  let have = 0n;
  for (let call = 0; call < (opts.maxFaucetCalls ?? 3) && have < need; call++) {
    const before = have;
    await faucet(account.address, fetchImpl);
    for (let i = 0; i < 15; i++) {
      have = await balance();
      if (have > before) break;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (have < need) throw new Error("The Tempo test faucet did not send enough test money for this pool. Try a smaller amount.");

  // 2. Deploy, with this wallet as sponsor.
  opts.onStep?.("deploying");
  const data = encodeDeployData({
    abi: matchPoolAbi,
    bytecode: MATCH_POOL_BYTECODE,
    args: [ALPHA, account.address, recipient, BigInt(ratioToBps(input.ratio)), toUnits(input.capUsd), BigInt(input.lockUntil), input.name],
  });
  const deployTx = await c.sendTransaction({ data, gas: 9_000_000n, feeToken: ALPHA, validBefore: validBefore() });
  const dr = await c.waitForTransactionReceipt({ hash: deployTx });
  if (dr.status !== "success" || !dr.contractAddress) throw new Error("The pool contract did not deploy on Tempo.");
  const address = dr.contractAddress;

  // 3. Approve and deposit the match pool.
  opts.onStep?.("depositing");
  const approveTx = await c.writeContract({
    address: ALPHA,
    abi: erc20Abi,
    functionName: "approve",
    args: [address, amount],
    gas: 500_000n,
    feeToken: ALPHA,
    validBefore: validBefore(),
  });
  const ar = await c.waitForTransactionReceipt({ hash: approveTx });
  if (ar.status !== "success") throw new Error("The approval for the deposit did not go through.");
  const depositTx = await c.writeContract({
    address,
    abi: matchPoolAbi,
    functionName: "deposit",
    args: [amount],
    gas: 1_000_000n,
    feeToken: ALPHA,
    validBefore: validBefore(),
  });
  const pr = await c.waitForTransactionReceipt({ hash: depositTx });
  if (pr.status !== "success") throw new Error("The deposit into the pool did not go through.");

  return { address, sponsor: account.address, deployTx, approveTx, depositTx, deployBlock: Number(dr.blockNumber), recipient };
}
