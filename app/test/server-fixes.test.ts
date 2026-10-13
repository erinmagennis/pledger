import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLine, shortAddress, type ClaimRecord, type LineEntry, type PaymentRecord } from "@/lib/claims";
import { HOLD_MS } from "@/lib/claims";
import { createHolds, loadLineData, loadLineWithHolds } from "@/lib/claims-server";
import { STUCK_MS, recordClaims, type AttestOptions, type RecordInput } from "@/lib/eas";
import { fulfilledTransfer, parseTempoBody } from "@/lib/onramp";
import { owedUnits } from "@/lib/payments-server";
import { computeTotals } from "@/lib/pledges";
import { limit, resetLimits, trackedIps } from "@/lib/ratelimit";
import { resetRetryThrottle, retryStuckRecords } from "@/lib/records-retry";
import { fakeDb, type FakeDb } from "./fake-db";

let current: FakeDb | null = null;
vi.mock("@/lib/supabase", () => ({ getSupabase: () => current?.db ?? null, DB_MISSING: { error: "Database not connected yet" } }));
const allocRoute = await import("@/app/api/line/allocate/route");
const holdRoute = await import("@/app/api/line/hold/route");
const verifyRoute = await import("@/app/api/payments/verify/route");

afterEach(() => {
  current = null;
  resetLimits();
  resetRetryThrottle();
});

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const pidOf = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
function claim(id: string, addr: string, feeCents: number, createdAt: string, selfBacked = false, extra: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    id,
    fingerprint: id.replace(/-/g, "").padStart(64, "f"),
    project: "P",
    purchased_at: "2026-08-01",
    fee_cents: feeCents,
    self_backed: selfBacked,
    payout_address: addr,
    display_mode: "initials",
    display_name: "A.",
    created_at: createdAt,
    ...extra,
  };
}
const pay = (to: string, units: string, at: string, tx = "0x1"): PaymentRecord => ({ tx_hash: tx, to_address: to, amount_units: units, block_time: at });

// ---------- 1. records: read first, tx hash first, ownership guard ----------

describe("recordClaims", () => {
  const input = (id: string): RecordInput => ({ claimId: id, fingerprint: "ab", project: "P", feeCents: 100, selfBacked: false, status: "paid", recipient: A });

  it("before sql/004 (no unique index), a second call reads the row and does not attest again", async () => {
    const f = fakeDb({ pledger_attestations: [], pledger_claims: [{ id: "c1" }] });
    const attest = vi.fn(async () => ({ state: "recorded" as const, uid: "0xuid", txHash: "0xtx" }));
    await recordClaims(f.db, [input("c1")], attest);
    await recordClaims(f.db, [input("c1")], attest);
    expect(attest).toHaveBeenCalledTimes(1);
    expect(f.tables.pledger_attestations).toHaveLength(1);
  });

  it("stores the tx hash as soon as it is sent, and a retry looks that tx up instead of sending again", async () => {
    const f = fakeDb({ pledger_attestations: [], pledger_claims: [{ id: "c1" }] });
    let hashOnRow: unknown = null;
    await recordClaims(f.db, [input("c1")], async (_i, opts?: AttestOptions) => {
      await opts!.onSent!("0xsent");
      hashOnRow = f.tables.pledger_attestations![0]!.tx_hash;
      return { state: "pending" as const, error: "wait timed out", txHash: "0xsent" };
    });
    expect(hashOnRow).toBe("0xsent");
    expect(f.tables.pledger_attestations![0]).toMatchObject({ state: "pending", tx_hash: "0xsent", error: "wait timed out" });
    const retry = vi.fn(async (_i: RecordInput, opts?: AttestOptions) => ({ state: "recorded" as const, uid: "0xuid", txHash: opts?.txHash }));
    await recordClaims(f.db, [input("c1")], retry);
    expect(retry.mock.calls[0]![1]!.txHash).toBe("0xsent");
    expect(f.tables.pledger_attestations![0]).toMatchObject({ state: "recorded", uid: "0xuid", tx_hash: "0xsent", error: null });
    expect(f.tables.pledger_claims![0]!.record_state).toBe("recorded");
  });

  it("a late writer cannot overwrite a run that took the row over", async () => {
    const f = fakeDb({ pledger_attestations: [], pledger_claims: [{ id: "c1" }] });
    await recordClaims(f.db, [input("c1")], async () => {
      // While this run waits, another run decides it is stuck and takes the row.
      f.tables.pledger_attestations![0]!.error = "retrying since 2026-10-12T12:00:00.000Z other";
      return { state: "recorded" as const, uid: "0xlate" };
    });
    expect(f.tables.pledger_attestations![0]).toMatchObject({ state: "pending", error: "retrying since 2026-10-12T12:00:00.000Z other" });
    expect(f.tables.pledger_attestations![0]!.uid).toBeUndefined();
    expect(f.tables.pledger_claims![0]!.record_state).toBeUndefined();
  });
});

// ---------- 2. retry sweep ----------

describe("retryStuckRecords", () => {
  const now = Date.parse("2026-10-12T12:00:00.000Z");
  const old = new Date(now - STUCK_MS - 60_000).toISOString();

  function setup() {
    return fakeDb({
      pledger_claims: [claim(pidOf(1), A, 1000, "2026-10-01T00:00:00Z"), claim(pidOf(2), B, 500, "2026-10-01T00:00:00Z")],
      // A is all paid but has no "paid" record; B has an "in line" record stuck as pending.
      pledger_payments: [pay(A, "10000000", "2026-10-05T00:00:00Z")],
      pledger_attestations: [
        { claim_id: pidOf(2), status: "in line", state: "pending", error: null, created_at: old },
        { claim_id: pidOf(1), status: "in line", state: "recorded", uid: "0xa", error: null, created_at: old },
      ],
    });
  }

  it("retries stuck pending rows and adds missing paid records, once per 5 minutes", async () => {
    const f = setup();
    const record = vi.fn(async (_db: SupabaseClient, _inputs: RecordInput[]) => {});
    expect(await retryStuckRecords(f.db, { record, configured: () => true }, now)).toBe(2);
    const sent = record.mock.calls[0]![1]!.map((i) => `${i.claimId}|${i.status}`).sort();
    expect(sent).toEqual([`${pidOf(1)}|paid`, `${pidOf(2)}|in line`]);
    expect(await retryStuckRecords(f.db, { record, configured: () => true }, now + 60_000)).toBe(0);
    expect(record).toHaveBeenCalledTimes(1);
    expect(await retryStuckRecords(f.db, { record, configured: () => true }, now + 5 * 60_000)).toBe(2);
  });

  it("does nothing without EAS keys, and end to end leaves the rows recorded", async () => {
    const f = setup();
    const record = vi.fn(async () => {});
    expect(await retryStuckRecords(f.db, { record, configured: () => false }, now)).toBe(0);
    expect(record).not.toHaveBeenCalled();
    resetRetryThrottle();
    const attest = vi.fn(async () => ({ state: "recorded" as const, uid: "0xnew" }));
    await retryStuckRecords(f.db, { record: (db, inputs) => recordClaims(db, inputs, attest, now), configured: () => true }, now);
    expect(attest).toHaveBeenCalledTimes(2);
    expect(f.tables.pledger_attestations!.filter((r) => r.state === "recorded")).toHaveLength(3);
  });
});

// ---------- 3. forgiveness is closed for good ----------

describe("a forgiven claim stays closed", () => {
  it("$10 paid with $9.95, then a new $5 claim: owes exactly $5.00", () => {
    const c1 = claim(pidOf(1), A, 1000, "2026-10-01T00:00:00Z");
    const before = buildLine([c1], [pay(A, "9950000", "2026-10-02T00:00:00Z")]);
    expect(owedUnits(before)).toBe(0n);
    const c2 = claim(pidOf(2), A, 500, "2026-10-03T00:00:00Z");
    const after = buildLine([c1, c2], [pay(A, "9950000", "2026-10-02T00:00:00Z")]);
    expect(owedUnits(after)).toBe(5_000_000n);
    expect(after[0]).toMatchObject({ feeCents: 1500, paidCents: 1000, status: "partial", forgivenCents: 5 });
  });

  it("forgivenCents is 0 when paid exactly or over, and $9.90 on $10 stays partial", () => {
    const c1 = claim(pidOf(1), A, 1000, "2026-10-01T00:00:00Z");
    expect(buildLine([c1], [pay(A, "10090000", "2026-10-02T00:00:00Z")])[0]).toMatchObject({ status: "paid", forgivenCents: 0 });
    expect(buildLine([c1], [pay(A, "9900000", "2026-10-02T00:00:00Z")])[0]).toMatchObject({ status: "partial", paidCents: 990, forgivenCents: 0 });
  });
});

// ---------- 4. chart keyed by full address ----------

describe("chart keys people by full address", () => {
  it("two people sharing a short address do not skew the chart", () => {
    const A1 = "0xaaaa111111111111111111111111111111111111";
    const A2 = "0xaaaa222222222222222222222222222222221111";
    const A1x = "0xaaaa333333333333333333333333333333331111";
    expect(shortAddress(A2)).toBe(shortAddress(A1x));
    const entry = (pid: string, address: string, feeCents: number, paidCents: number): LineEntry & { address: string; personFees: number[] } => ({
      pid, place: 1, group: 2, label: "x", projects: ["P"], feeCents, paidCents, status: "paid", shortAddress: shortAddress(address), firstAt: "1", address, personFees: [feeCents],
    });
    const line = [entry("p1", A2, 1000, 1000), entry("p2", A1x, 500, 500)];
    // A2 overpays $30 on a $10 fee on day 1; A1x pays $5 on day 2.
    const pays = [pay(A2, "30000000", "2026-10-10T10:00:00Z", "0x1"), pay(A1x, "5000000", "2026-10-11T10:00:00Z", "0x2")];
    expect(computeTotals(null, line, pays).series).toEqual([0, 1000, 1500]);
    expect(A1).not.toBe(A2);
  });

  it("loadLineData carries the full address and claim fees for the chart; loadLine-style data leaves them out", async () => {
    const f = fakeDb({ pledger_claims: [claim(pidOf(1), A, 1000, "2026-10-01T00:00:00Z")], pledger_payments: [] });
    const { line } = await loadLineData(f.db);
    expect(line[0]).toMatchObject({ address: A, personFees: [1000] });
    const pub = await loadLineWithHolds(f.db);
    expect("address" in pub[0]!).toBe(false);
  });
});

// ---------- 5. null bodies ----------

describe("routes answer 400 to a JSON null body", () => {
  const post = (route: { POST: (r: Request) => Promise<Response> }) =>
    route.POST(new Request("http://x/api", { method: "POST", headers: { "x-forwarded-for": "4.4.4.4" }, body: "null" }));
  it.each([
    ["line/allocate", allocRoute],
    ["line/hold", holdRoute],
    ["payments/verify", verifyRoute],
  ])("%s", async (_name, route) => {
    current = fakeDb({ pledger_claims: [] });
    const res = await post(route);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Send a JSON object" });
  });
});

// ---------- 6. Tempo body ----------

describe("parseTempoBody", () => {
  const addr = "0x1111111111111111111111111111111111111111";
  it("takes numbers only, and null or missing means $20", () => {
    expect(parseTempoBody({ network: "tempo", address: addr })).toEqual({ address: addr, amountCents: 2000 });
    expect(parseTempoBody({ network: "tempo", address: addr, amountUsd: null })).toEqual({ address: addr, amountCents: 2000 });
    expect(parseTempoBody({ network: "tempo", address: addr, amountUsd: 7 })).toEqual({ address: addr, amountCents: 700 });
    for (const amountUsd of [true, [7], "0x10", "7", 0, 501, Number.NaN]) {
      expect(parseTempoBody({ network: "tempo", address: addr, amountUsd })).toEqual({ error: "Amount must be $1 to $500" });
    }
  });
  it("needs the address as a string", () => {
    expect(parseTempoBody({ network: "tempo", address: [addr] })).toEqual({ error: "Send a valid wallet address" });
    expect(parseTempoBody({ network: "tempo", address: null })).toEqual({ error: "Send a valid wallet address" });
  });
});

// ---------- 7. webhook ignores a Tempo delivery with no network ----------

describe("fulfilledTransfer", () => {
  const ev = (td: Record<string, unknown>) => ({ type: "crypto.onramp_session.updated", data: { object: { status: "fulfillment_complete", transaction_details: { transaction_id: "0x" + "ab".repeat(32), ...td } } } });
  it("needs the Base wallet field", () => {
    expect(fulfilledTransfer(ev({ wallet_addresses: { tempo: A } }))).toBeNull();
    expect(fulfilledTransfer(ev({ wallet_addresses: { base_network: A } }))).toEqual({ txHash: "0x" + "ab".repeat(32), to: A });
    expect(fulfilledTransfer(ev({ wallet_address: A }))).toEqual({ txHash: "0x" + "ab".repeat(32), to: A });
  });
});

// ---------- 9. hold cooldown ----------

describe("hold cooldown", () => {
  const now = Date.parse("2026-10-12T12:00:00.000Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  const hold = (addr: string, createdMs: number, expiresMs: number) => ({ id: "h-" + addr.slice(2, 4) + createdMs, payout_address: addr, created_at: iso(createdMs), expires_at: iso(expiresMs), source: "pledger" });

  it("skips a person whose full hold lapsed in the last 20 minutes with no payment since", async () => {
    const f = fakeDb({ pledger_holds: [hold(A, now - 15 * 60_000, now - 5 * 60_000)], pledger_payments: [] });
    const r = await createHolds(f.db, [A, B], "pledger", now);
    expect(r.ok && [...r.ids.keys()]).toEqual([B]);
    expect(r.ok && r.skipped).toEqual([A]);
  });

  it("holds again after a payment since that hold, after 20 minutes, or after a hold ended early", async () => {
    const paid = fakeDb({ pledger_holds: [hold(A, now - 15 * 60_000, now - 5 * 60_000)], pledger_payments: [{ ...pay(A, "1000000", iso(now - 10 * 60_000)), kind: "paid", created_at: iso(now - 10 * 60_000) }] });
    expect((await createHolds(paid.db, [A], "pledger", now)).ok && (await createHolds(paid.db, [A], "pledger", now + 1))).toMatchObject({ skipped: [] });
    const longAgo = fakeDb({ pledger_holds: [hold(A, now - 35 * 60_000, now - 25 * 60_000)], pledger_payments: [] });
    expect(await createHolds(longAgo.db, [A], "pledger", now)).toMatchObject({ ok: true, skipped: [] });
    const early = fakeDb({ pledger_holds: [hold(A, now - 8 * 60_000, now - 6 * 60_000)], pledger_payments: [] });
    expect(await createHolds(early.db, [A], "pledger", now)).toMatchObject({ ok: true, skipped: [] });
    expect(HOLD_MS).toBe(10 * 60_000);
  });

  it("the hold route returns skipped pids", async () => {
    current = fakeDb({ pledger_claims: [claim(pidOf(1), A, 1000, "2026-10-01T00:00:00Z")], pledger_holds: [hold(A, Date.now() - 15 * 60_000, Date.now() - 5 * 60_000)], pledger_payments: [] });
    const res = await holdRoute.POST(new Request("http://x/api", { method: "POST", headers: { "x-forwarded-for": "5.6.7.8" }, body: JSON.stringify({ pids: [pidOf(1)], source: "pledger" }) }));
    expect(await res.json()).toMatchObject({ held: false, pids: [], skipped: [pidOf(1)] });
  });
});

// ---------- 10. rate limiter prunes ----------

describe("rate limiter", () => {
  it("drops IPs with no hit in two windows", () => {
    limit("prune", "1.1.1.1", 5, 1000, 0);
    limit("prune", "2.2.2.2", 5, 1000, 1500);
    expect(trackedIps("prune")).toBe(2);
    limit("prune", "3.3.3.3", 5, 1000, 2500);
    expect(trackedIps("prune")).toBe(2);
  });
});

// ---------- 12. record state on the public line ----------

describe("public line records", () => {
  it("shows record state and the latest recorded uid per entry, null when unknown", async () => {
    const f = fakeDb({
      pledger_claims: [
        { ...claim(pidOf(1), A, 1000, "2026-10-01T00:00:00Z"), record_state: "recorded" },
        { ...claim(pidOf(2), A, 500, "2026-10-02T00:00:00Z"), record_state: "recorded" },
        { ...claim(pidOf(3), B, 700, "2026-10-01T00:00:00Z"), record_state: "pending" },
      ],
      pledger_payments: [],
      pledger_attestations: [
        { claim_id: pidOf(1), status: "in line", state: "recorded", uid: "0xold", created_at: "2026-10-01T00:01:00Z" },
        { claim_id: pidOf(2), status: "in line", state: "recorded", uid: "0xnew", created_at: "2026-10-02T00:01:00Z" },
      ],
    });
    const line = await loadLineWithHolds(f.db);
    const a = line.find((e) => e.pid === pidOf(1))!;
    const b = line.find((e) => e.pid === pidOf(3))!;
    expect([a.recordState, a.recordUid]).toEqual(["recorded", "0xnew"]);
    expect([b.recordState, b.recordUid]).toEqual(["pending", null]);
  });

  it("degrades to null when the attestations table cannot be read", async () => {
    const f = fakeDb({ pledger_claims: [claim(pidOf(1), A, 1000, "2026-10-01T00:00:00Z")], pledger_payments: [] }, {}, { missing: ["pledger_attestations"] });
    const [e] = await loadLineWithHolds(f.db);
    expect([e!.recordState, e!.recordUid]).toEqual([null, null]);
  });
});
