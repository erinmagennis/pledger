// Is Tempo's public test faucet working? Kept in memory per server instance, so pages can say so
// calmly and turn off the submit instead of sending people into a failure.
// Sources, in order: the last real faucet call from /api/pledges/create or /api/demo/fund (trusted
// for DOWN_FOR_MS), then at most one probe per PROBE_EVERY_MS from /api/faucet/status when nothing
// recent is known. The probe asks the faucet to fund a fixed burn address, so it never spams.

export const FAUCET_DOWN_MSG = "Tempo's test faucet is down right now, so new test pledges can't be funded. Try again later.";

export const DOWN_FOR_MS = 2 * 60 * 1000;
export const PROBE_EVERY_MS = 60 * 1000;
/** Nobody holds the key to this address. Probe funds land here and stay. */
export const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

type Seen = { ok: boolean; at: number };
let last: Seen | null = null;
let lastProbeAt = 0;
let probing: Promise<boolean> | null = null;

/** The faucet itself failed (selfserve-chain's errors). "Did not send enough" is about the amount, not an outage. */
export function isFaucetError(msg: string): boolean {
  return /tempo test faucet (answered|said)/i.test(msg);
}

export function noteFaucet(ok: boolean, now = Date.now()): void {
  last = { ok, at: now };
}

/** True when the last faucet call failed within DOWN_FOR_MS and nothing has worked since. */
export function faucetDown(now = Date.now()): boolean {
  return !!last && !last.ok && now - last.at < DOWN_FOR_MS;
}

/** One faucet call on the burn address. True when the faucet took it. */
export async function probeFaucet(rpc: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tempo_fundAddress", params: [BURN_ADDRESS] }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const j = (await res.json().catch(() => ({}))) as { error?: unknown };
    return !j.error;
  } catch {
    return false;
  }
}

/** The status for the form: a recent real result if there is one, else a probe at most once per PROBE_EVERY_MS. */
export async function faucetStatus(rpc: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<{ down: boolean }> {
  if (probing) return { down: !(await probing) };
  const fresh = last && now - last.at < (last.ok ? PROBE_EVERY_MS : DOWN_FOR_MS);
  if (fresh || now - lastProbeAt < PROBE_EVERY_MS) return { down: faucetDown(now) };
  lastProbeAt = now;
  probing = probeFaucet(rpc, fetchImpl)
    .then((ok) => {
      noteFaucet(ok, now);
      return ok;
    })
    .finally(() => {
      probing = null;
    });
  return { down: !(await probing) };
}

/** Tests only. */
export function resetFaucetStatus(): void {
  last = null;
  lastProbeAt = 0;
  probing = null;
}
