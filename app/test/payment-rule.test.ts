import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Hex } from "viem";
import { BASE_USDC, TRANSFER_TOPIC, checkPaymentRule, usdcTransfersTo, type CheckedPayment, type ReceiptLike } from "@/lib/base";
import type { LineEntry } from "@/lib/claims";
import { allPaid, extraMessage, owedUnits, recordUsdcPayment, type PaymentDeps } from "@/lib/payments-server";
import type { RecordInput } from "@/lib/eas";
import { fakeDb, type FakeSchema } from "./fake-db";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const usd = (n: number) => BigInt(Math.round(n * 100)) * 10_000n;
const topic = (a: string) => "0x" + a.slice(2).padStart(64, "0");
const log = (from: string, to: string, units: bigint) => ({ address: BASE_USDC, topics: [TRANSFER_TOPIC, topic(from), topic(to)], data: "0x" + units.toString(16) });

describe("self-transfers do not count", () => {
  it("splits payments from others and from the wallet itself", () => {
    const receipt: ReceiptLike = { status: "success", blockNumber: 1n, logs: [log(B, A, usd(5)), log(A, A, usd(10))] };
    expect(usdcTransfersTo(receipt, A)).toEqual({ units: usd(5), selfUnits: usd(10) });
  });
});

describe("payment rule", () => {
  const ok = { blockTime: "2026-10-12T10:00:01.000Z", firstClaimAt: "2026-10-12T10:00:00.123456+00:00", amountUnits: usd(10), owedUnits: usd(10) };

  it("accepts the exact amount sent after the first claim", () => {
    expect(checkPaymentRule(ok)).toEqual({ ok: true });
  });

  it("rejects a payment sent before (or at the same time as) the first claim", () => {
    const before = { ok: false, error: "Sent before this claim was made" };
    expect(checkPaymentRule({ ...ok, blockTime: "2026-10-01T00:00:00.000Z" })).toEqual(before);
    expect(checkPaymentRule({ ...ok, blockTime: "2026-10-12T10:00:00.123Z" })).toEqual(before);
  });

  it("accepts within 0.5% either way", () => {
    expect(checkPaymentRule({ ...ok, amountUnits: 9_950_000n })).toEqual({ ok: true });
    expect(checkPaymentRule({ ...ok, amountUnits: 10_050_000n })).toEqual({ ok: true });
  });

  it("rejects below or above the range with what is owed", () => {
    const err = { ok: false, error: "Does not match what is owed ($10.00)" };
    expect(checkPaymentRule({ ...ok, amountUnits: 9_949_999n })).toEqual(err);
    expect(checkPaymentRule({ ...ok, amountUnits: 10_050_001n })).toEqual(err);
    expect(checkPaymentRule({ ...ok, amountUnits: usd(5) })).toEqual(err);
  });

  it("rejects any payment to someone who owes nothing", () => {
    expect(checkPaymentRule({ ...ok, owedUnits: 0n })).toEqual({ ok: false, error: "Does not match what is owed ($0.00)" });
  });

  it("owed is fee minus paid over unpaid and partial places", () => {
    const e = (feeCents: number, paidCents: number, status: LineEntry["status"]) => ({ feeCents, paidCents, status }) as LineEntry;
    expect(owedUnits([e(1000, 1000, "paid"), e(500, 200, "partial"), e(250, 0, "waiting")])).toBe(usd(5.5));
    expect(allPaid([e(1000, 1000, "paid")])).toBe(true);
    expect(allPaid([])).toBe(false);
  });
});

// ---------- recordUsdcPayment with a fake database ----------

const TX = ("0x" + "1".repeat(64)) as Hex;
const TX2 = ("0x" + "2".repeat(64)) as Hex;

function claimRow(id: string, feeCents: number, selfBacked: boolean, created = "2026-10-10T00:00:00.000000+00:00") {
  return {
    id: `00000000-0000-0000-0000-00000000000${id}`,
    fingerprint: id.repeat(64).slice(0, 64),
    project: `P${id}`,
    purchased_at: "2026-08-01",
    fee_cents: feeCents,
    self_backed: selfBacked,
    payout_address: A,
    display_mode: "initials",
    display_name: "A. A.",
    created_at: created,
  };
}

/** The database before sql/005: pledger_payments has no `kind` column. */
const BEFORE_005: FakeSchema = { columns: { pledger_payments: ["tx_hash", "to_address", "amount_units", "block_number", "block_time"] } };

/** `wrap` swaps the client the payment code sees (to act out a failing read). */
function setup(opts: { payments?: Record<string, unknown>[]; units?: bigint; blockTime?: string; check?: CheckedPayment; schema?: FakeSchema; wrap?: (db: SupabaseClient) => SupabaseClient } = {}) {
  const f = fakeDb(
    { pledger_claims: [claimRow("1", 1000, true), claimRow("2", 500, false)], pledger_payments: opts.payments ?? [] },
    { pledger_payments: ["tx_hash", "to_address"] },
    opts.schema,
  );
  const attested: RecordInput[][] = [];
  const deps: Partial<PaymentDeps> = {
    check: async (h) =>
      opts.check ?? { ok: true, txHash: h, to: A, amountUnits: opts.units ?? usd(15), blockNumber: 5n, blockTime: opts.blockTime ?? "2026-10-12T00:00:00.000Z" },
    attest: async (_db, inputs) => void attested.push(inputs),
    later: (fn) => void fn(),
  };
  const db = opts.wrap ? opts.wrap(f.db) : f.db;
  return { ...f, attested, run: (tx: Hex = TX) => recordUsdcPayment(db, A, tx, deps) };
}

describe("recordUsdcPayment", () => {
  it("records the full amount as-is and attests every claim once, on the step to all paid", async () => {
    const s = setup({ units: 15_050_000n });
    const r = await s.run();
    expect(r.ok).toBe(true);
    expect(s.tables.pledger_payments).toHaveLength(1);
    expect(s.tables.pledger_payments![0]!.amount_units).toBe("15050000");
    expect(s.attested).toHaveLength(1);
    expect(s.attested[0]!.map((i) => i.status)).toEqual(["paid", "paid"]);
  });

  it("rejects a self-transfer with a plain message", async () => {
    const s = setup({ check: { ok: false, reason: "self-transfer" } });
    expect(await s.run()).toMatchObject({ ok: false, status: 400, error: "A wallet cannot pay itself" });
    expect(s.tables.pledger_payments).toHaveLength(0);
  });

  it("rejects a payment made before the first claim", async () => {
    const s = setup({ blockTime: "2026-10-01T00:00:00.000Z" });
    expect(await s.run()).toMatchObject({ ok: false, error: "Sent before this claim was made" });
    expect(s.tables.pledger_payments).toHaveLength(0);
  });

  it("before sql/005: rejects a partial payment, names the full amount, and logs one line for follow-up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup({ units: usd(10), schema: BEFORE_005 });
    expect(await s.run()).toMatchObject({ ok: false, error: "Does not match what is owed ($15.00)" });
    expect(s.attested).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("[pledger] payment rejected", { txHash: TX, to: A, reason: "Does not match what is owed ($15.00)", amountUnits: "10000000", owedUnits: "15000000" });
    expect(s.tables.pledger_payments).toHaveLength(0);
    warn.mockRestore();
  });

  it("records a partial payment as an extra: logged, shown on the row, never counted or attested", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup({ units: usd(10) });
    const r = await s.run();
    expect(r).toMatchObject({ ok: true, extra: { message: "Recorded as extra: it does not match what this person is owed ($15.00)" } });
    expect(s.tables.pledger_payments).toEqual([expect.objectContaining({ tx_hash: TX, amount_units: "10000000", kind: "extra" })]);
    expect(s.attested).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("[pledger] payment rejected", expect.objectContaining({ reason: "Does not match what is owed ($15.00)" }));
    // Still owes the full $15: the extra never fills a place, and it shows on the person's first place.
    const entries = r.ok ? r.entries : [];
    expect(entries.map((e) => [e.status, e.paidCents])).toEqual([["waiting", 0], ["waiting", 0]]);
    expect(entries[0]!.extras).toEqual([{ cents: 1000, txHash: TX }]);
    expect(entries[1]!.extras).toBeUndefined();
    warn.mockRestore();
  });

  it("an extra does not change what is owed: the full amount after it still counts and attests", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup({ units: usd(20) });
    expect((await s.run()).ok).toBe(true); // $20 against $15 owed: an extra
    s.attested.length = 0;
    const r = await recordUsdcPayment(s.db, A, TX2, {
      check: async (h) => ({ ok: true, txHash: h, to: A, amountUnits: usd(15), blockNumber: 6n, blockTime: "2026-10-12T00:00:00.000Z" }),
      attest: async (_db, inputs) => void s.attested.push(inputs),
      later: (fn) => void fn(),
    });
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.extra).toBeFalsy();
    expect(s.attested).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("an overpayment is an extra too, and a payment sent before the claim is still not recorded", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const over = setup({ units: usd(16) });
    expect(await over.run()).toMatchObject({ ok: true, extra: { message: extraMessage(usd(15)) } });
    const early = setup({ units: usd(16), blockTime: "2026-10-01T00:00:00.000Z" });
    expect(await early.run()).toMatchObject({ ok: false, error: "Sent before this claim was made" });
    expect(early.tables.pledger_payments).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("accepts 99.5% of what is owed and attests, with nothing left owing", async () => {
    const s = setup({ units: 14_925_000n });
    expect((await s.run()).ok).toBe(true);
    expect(s.attested).toHaveLength(1);
  });

  it("owes only what is left after earlier payments, and still attests on the transition", async () => {
    const earlier = { tx_hash: TX2, to_address: A, amount_units: "10000000", block_time: "2026-10-11T00:00:00Z" };
    const s = setup({ payments: [earlier], units: usd(5) });
    expect((await s.run()).ok).toBe(true);
    expect(s.attested).toHaveLength(1);
  });

  it("an extra for someone already paid retries their paid records (recordClaims skips recorded ones)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const earlier = { tx_hash: TX2, to_address: A, amount_units: "15000000", block_time: "2026-10-11T00:00:00Z" };
    const s = setup({ payments: [earlier], units: usd(15) });
    expect(await s.run()).toMatchObject({ ok: true, extra: { message: "Recorded as extra: it does not match what this person is owed ($0.00)" } });
    expect(s.attested).toHaveLength(1);
    expect(s.attested[0]!.map((i) => i.status)).toEqual(["paid", "paid"]);
    // Before sql/005 it is rejected as before.
    const old = setup({ payments: [{ ...earlier }], units: usd(15), schema: BEFORE_005 });
    expect(await old.run()).toMatchObject({ ok: false, error: "Does not match what is owed ($0.00)" });
    expect(old.attested).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("does not store an extra under $1.00: rejected with the rule message and logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup({ units: 999_999n });
    expect(await s.run()).toMatchObject({ ok: false, status: 400, error: "Does not match what is owed ($15.00)" });
    expect(s.tables.pledger_payments).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("[pledger] extra not saved", expect.objectContaining({ txHash: TX, reason: "under-minimum" }));
    warn.mockRestore();
  });

  it("stores at most 5 extras per person: the 6th is rejected and logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const five = Array.from({ length: 5 }, (_, i) => ({ tx_hash: `0x${"e".repeat(63)}${i}`, to_address: A, amount_units: "2000000", block_time: "2026-10-11T00:00:00Z", kind: "extra" }));
    const s = setup({ payments: five, units: usd(10) });
    expect(await s.run()).toMatchObject({ ok: false, status: 400, error: "Does not match what is owed ($15.00)" });
    expect(s.tables.pledger_payments).toHaveLength(5);
    expect(warn).toHaveBeenCalledWith("[pledger] extra not saved", expect.objectContaining({ txHash: TX, reason: "extras-full" }));
    warn.mockRestore();
  });

  it("an outage while saving an extra answers 500, not the rule message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup({ units: usd(10), schema: { insertError: { pledger_payments: { code: "08006", message: "connection failure" } } } });
    expect(await s.run()).toEqual({ ok: false, status: 500, error: "Could not save the payment" });
    expect(warn).toHaveBeenCalledWith("[pledger] extra not saved", { txHash: TX, code: "08006" });
    warn.mockRestore();
  });

  it("an extra for someone not yet paid does not attest", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup({ units: usd(10) });
    expect(await s.run()).toMatchObject({ ok: true, extra: expect.anything() });
    expect(s.attested).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("still attests on the step to all paid when the re-read after saving fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Every pledger_payments read made after the payment insert fails, like a dropped connection.
    let saved = false;
    const wrap = (db: SupabaseClient) =>
      ({
        from: (name: string) => {
          const q = db.from(name) as unknown as Record<string, unknown>;
          if (name !== "pledger_payments") return q;
          if (saved) return { ...q, select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: null, error: { code: "08006" } }), limit: async () => ({ data: null, error: { code: "08006" } }) }) }), order: () => ({ range: async () => ({ data: null, error: { code: "08006" } }) }) }) }) };
          const insert = q.insert as (r: unknown) => unknown;
          return { ...q, insert: (r: unknown) => ((saved = true), insert(r)) };
        },
      }) as unknown as SupabaseClient;
    const s = setup({ units: usd(15), wrap });
    expect((await s.run()).ok).toBe(true);
    expect(s.tables.pledger_payments).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("[pledger] payments re-read failed, using the saved row", { txHash: TX, to: A });
    expect(s.attested).toHaveLength(1);
    warn.mockRestore();
  });

  it("keeps idempotency: the same tx and person is already recorded", async () => {
    const s = setup();
    expect((await s.run()).ok).toBe(true);
    expect(await s.run()).toMatchObject({ ok: false, status: 409, duplicate: true });
    expect(s.attested).toHaveLength(1);
  });
});
