import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allocate, type AllocEntry } from "@/lib/allocate";
import { HOLD_MS, buildLine, paidFromLine, type ClaimRecord, type PaymentRecord } from "@/lib/claims";
import { EXTRAS_PER_ADDRESS, EXTRAS_READ_LIMIT, activeHolds, createHolds, isMissingSchema, loadLineData, loadLineWithHolds, readPayments } from "@/lib/claims-server";
import { computeTotals } from "@/lib/pledges";
import { fakeDb, type FakeDb } from "./fake-db";

let current: FakeDb | null = null;
vi.mock("@/lib/supabase", () => ({ getSupabase: () => current?.db ?? null, DB_MISSING: { error: "Database not connected yet" } }));
const lineRoute = await import("@/app/api/line/route");
const allocRoute = await import("@/app/api/line/allocate/route");
const holdRoute = await import("@/app/api/line/hold/route");

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";
const PID = { [A]: "00000000-0000-0000-0000-00000000000a", [B]: "00000000-0000-0000-0000-00000000000b", [C]: "00000000-0000-0000-0000-00000000000c" };
const usd = (n: number) => BigInt(Math.round(n * 100)) * 10_000n;

function claim(addr: string, feeCents: number): ClaimRecord {
  return {
    id: PID[addr]!,
    fingerprint: addr.slice(2, 3).repeat(64),
    project: `P-${addr.slice(2, 3)}`,
    purchased_at: "2026-08-01",
    fee_cents: feeCents,
    self_backed: false,
    payout_address: addr,
    display_mode: "initials",
    display_name: addr.slice(2, 3).toUpperCase() + ".",
    created_at: "2026-10-10T00:00:00.000Z",
  };
}

/** A $10, B $20, C $30 in line, plus the given holds and payments. `missing` acts out the database before sql/005. */
function db(opts: { holds?: Record<string, unknown>[]; payments?: Record<string, unknown>[]; missing?: string[] } = {}) {
  current = fakeDb(
    { pledger_claims: [claim(A, 1000), claim(B, 2000), claim(C, 3000)], pledger_payments: opts.payments ?? [], pledger_holds: opts.holds ?? [] },
    {},
    { missing: opts.missing },
  );
  return current;
}
const holdRow = (addr: string, untilMs: number, source = "pledger") => ({ payout_address: addr, expires_at: new Date(untilMs).toISOString(), source });
const post = (route: { POST: (r: Request) => Promise<Response> }, body: unknown, ip = "1.1.1.1") =>
  route.POST(new Request("http://x/api", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify(body) }));

afterEach(() => {
  current = null;
  vi.useRealTimers();
});

// ---------- holds ----------

describe("allocate skips held people", () => {
  const entry = (place: number, address: string, owed: number, held = false): AllocEntry => ({ entryId: `e${place}`, pid: `p${place}`, address, label: `L${place}`, place, remainingUnits: usd(owed), held });

  it("amount: goes past a held person to the next one who fits", () => {
    const r = allocate([entry(1, A, 10, true), entry(2, B, 20), entry(3, C, 30)], { kind: "amount", amountUnits: usd(25) });
    expect(r.transfers.map((t) => t.address)).toEqual([B]);
    expect(r.leftoverUnits).toBe(usd(5));
    expect(r.nextUnits).toBe(usd(30));
  });

  it("next N: a held person does not take one of the N places", () => {
    const r = allocate([entry(1, A, 10, true), entry(2, B, 20), entry(3, C, 30)], { kind: "nextN", n: 2 });
    expect(r.transfers.map((t) => t.address)).toEqual([B, C]);
  });
});

describe("hold expiry", () => {
  it("counts only running holds, latest expiry per person", async () => {
    const now = Date.parse("2026-10-12T12:00:00.000Z");
    const f = db({ holds: [holdRow(A, now - 1000), holdRow(B, now + 60_000), holdRow(B, now + 300_000, "outside")] });
    const holds = await activeHolds(f.db, now);
    expect([...holds]).toEqual([[B, new Date(now + 300_000).toISOString()]]);
  });

  it("a new hold lasts 10 minutes, then the person is back in the split", async () => {
    const now = Date.parse("2026-10-12T12:00:00.000Z");
    const f = db();
    expect(await createHolds(f.db, [A.toUpperCase().replace("0X", "0x")], "pledger", now)).toMatchObject({ ok: true, until: new Date(now + HOLD_MS).toISOString() });
    expect((await loadLineWithHolds(f.db, now + HOLD_MS - 1)).find((e) => e.pid === PID[A])).toMatchObject({ held: true, heldUntil: new Date(now + HOLD_MS).toISOString() });
    expect((await loadLineWithHolds(f.db, now + HOLD_MS)).find((e) => e.pid === PID[A])!.held).toBeUndefined();
  });

  it("before sql/005 (no holds table): nobody is held and creating a hold says missing", async () => {
    const f = db({ missing: ["pledger_holds"] });
    expect((await activeHolds(f.db)).size).toBe(0);
    expect((await loadLineWithHolds(f.db)).some((e) => e.held)).toBe(false);
    expect(await createHolds(f.db, [A], "outside")).toEqual({ ok: false, missing: true });
  });
});

describe("/api/line marks held people", () => {
  it("adds held and heldUntil to every place of a held person", async () => {
    const until = Date.now() + 120_000;
    db({ holds: [holdRow(B, until)] });
    const j = await (await lineRoute.GET()).json();
    const b = j.line.find((e: { pid: string }) => e.pid === PID[B]);
    expect(b).toMatchObject({ held: true, heldUntil: new Date(until).toISOString() });
    expect(j.line.filter((e: { held?: boolean }) => e.held)).toHaveLength(1);
  });

  it("still answers before sql/005", async () => {
    db({ missing: ["pledger_holds"] });
    const res = await lineRoute.GET();
    expect(res.status).toBe(200);
    expect((await res.json()).line).toHaveLength(3);
  });
});

describe("/api/line/allocate leaves held people out", () => {
  it("skips a person someone else holds and says how many were skipped", async () => {
    db({ holds: [holdRow(A, Date.now() + 120_000)] });
    const j = await (await post(allocRoute, { nextN: 1 })).json();
    expect(j.transfers.map((t: { address: string }) => t.address)).toEqual([B]);
    expect(j.transfers[0].pid).toBe(PID[B]);
    expect(j.heldCount).toBe(1);
    expect(j.holdsIgnored).toBe(false);
  });

  it("fails open: when more than half of the open people are held, holds are ignored for the split", async () => {
    db({ holds: [holdRow(A, Date.now() + 120_000), holdRow(B, Date.now() + 120_000)] });
    const j = await (await post(allocRoute, { nextN: 1 })).json();
    expect(j.transfers.map((t: { address: string }) => t.address)).toEqual([A]);
    expect(j.holdsIgnored).toBe(true);
    expect(j.heldCount).toBe(0);
  });

  it("does not hide people from the helper who holds them (mine)", async () => {
    db({ holds: [holdRow(A, Date.now() + 120_000)] });
    const j = await (await post(allocRoute, { nextN: 1, mine: [PID[A]] })).json();
    expect(j.transfers.map((t: { address: string }) => t.address)).toEqual([A]);
    expect(j.heldCount).toBe(0);
  });

  it("before sql/005 allocates as today", async () => {
    db({ missing: ["pledger_holds"] });
    const j = await (await post(allocRoute, { amountUsd: 30 })).json();
    expect(j.transfers.map((t: { address: string }) => t.address)).toEqual([A, B]);
    expect(j.heldCount).toBe(0);
  });
});

describe("/api/line/hold", () => {
  it("outside: holds the person for 10 minutes and stores the source", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-12T12:00:00.000Z"));
    const f = db();
    const res = await post(holdRoute, { pids: [PID[C]], source: "outside" }, "2.2.2.2");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ held: true, until: "2026-10-12T12:10:00.000Z", pids: [PID[C]], skipped: [] });
    expect(f.tables.pledger_holds).toEqual([{ id: expect.any(String), payout_address: C, created_at: "2026-10-12T12:00:00.000Z", expires_at: "2026-10-12T12:10:00.000Z", source: "outside" }]);
  });

  it("before sql/005: answers held false, so the payer still sees the amount and address", async () => {
    db({ missing: ["pledger_holds"] });
    const res = await post(holdRoute, { pids: [PID[C]], source: "outside" }, "3.3.3.3");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ held: false, pids: [PID[C]] });
  });

  it("checks the request: source, pid list, up to 10, unknown people", async () => {
    db();
    expect((await post(holdRoute, { pids: [PID[A]], source: "other" }, "4.4.4.4")).status).toBe(400);
    expect((await post(holdRoute, { pids: [], source: "pledger" }, "4.4.4.4")).status).toBe(400);
    const many = Array.from({ length: 11 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    expect((await post(holdRoute, { pids: many, source: "pledger" }, "4.4.4.4")).status).toBe(400);
    expect((await post(holdRoute, { pids: ["00000000-0000-0000-0000-999999999999"], source: "pledger" }, "4.4.4.4")).status).toBe(404);
  });

  it("limits holds per IP", async () => {
    db();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await post(holdRoute, { pids: [PID[A]], source: "pledger" }, "5.5.5.5")).status;
    expect(last).toBe(429);
    expect((await post(holdRoute, { pids: [PID[A]], source: "pledger" }, "6.6.6.6")).status).toBe(200);
  });

  it("one IP holds at most 10 people: holding more ends its oldest holds", async () => {
    const addr = (i: number) => `0x${String(i).padStart(40, "d")}`;
    const pid = (i: number) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
    const claims = Array.from({ length: 12 }, (_, i) => ({ ...claim(A, 1000), id: pid(i), fingerprint: String(i).padStart(64, "f"), payout_address: addr(i) }));
    const f = (current = fakeDb({ pledger_claims: claims, pledger_payments: [], pledger_holds: [] }));
    expect((await post(holdRoute, { pids: claims.slice(0, 10).map((c) => c.id), source: "pledger" }, "7.7.7.7")).status).toBe(200);
    expect((await activeHolds(f.db)).size).toBe(10);
    expect((await post(holdRoute, { pids: [pid(10), pid(11)], source: "pledger" }, "7.7.7.7")).status).toBe(200);
    const held = await activeHolds(f.db, Date.now() + 1);
    expect(held.size).toBe(10);
    expect([held.has(addr(0)), held.has(addr(1)), held.has(addr(2)), held.has(addr(10)), held.has(addr(11))]).toEqual([false, false, true, true, true]);
    // Refreshing a person already held does not end anyone, and another IP has its own 10.
    expect((await post(holdRoute, { pids: [pid(2)], source: "pledger" }, "7.7.7.7")).status).toBe(200);
    expect((await activeHolds(f.db, Date.now() + 1)).size).toBe(10);
    expect((await post(holdRoute, { pids: [pid(0)], source: "pledger" }, "8.8.8.8")).status).toBe(200);
    expect((await activeHolds(f.db, Date.now() + 1)).size).toBe(11);
  });

  it("clears holds that ended over a day ago when it adds new ones", async () => {
    const now = Date.parse("2026-10-12T12:00:00.000Z");
    const f = db({ holds: [holdRow(A, now - 2 * 86_400_000), holdRow(B, now - 3_600_000)] });
    expect((await createHolds(f.db, [C], "pledger", now)).ok).toBe(true);
    expect(f.tables.pledger_holds!.map((h) => h.payout_address)).toEqual([B, C]);
  });

  it("never blocks recording: a held person can still be paid in the line", async () => {
    const f = db({ holds: [holdRow(A, Date.now() + 120_000)], payments: [{ tx_hash: "0x1", to_address: A, amount_units: "10000000", block_time: "2026-10-11T00:00:00Z" }] });
    const a = (await loadLineWithHolds(f.db)).find((e) => e.pid === PID[A])!;
    expect([a.status, a.held]).toEqual(["paid", true]);
  });
});

// ---------- extras ----------

describe("extras never count", () => {
  const paid: PaymentRecord = { tx_hash: "0xp", to_address: A, amount_units: "10000000", block_time: "2026-10-11T00:00:00Z", kind: "paid" };
  const extra: PaymentRecord = { tx_hash: "0xe", to_address: B, amount_units: "5000000", block_time: "2026-10-11T00:00:00Z", kind: "extra" };

  it("buildLine leaves extras out of paid and lists them on the person's first place", () => {
    const line = buildLine([claim(A, 1000), claim(B, 2000)], [paid, extra]);
    const b = line.find((e) => e.pid === PID[B])!;
    expect([b.status, b.paidCents, b.extras]).toEqual(["waiting", 0, [{ cents: 500, txHash: "0xe" }]]);
    expect(paidFromLine(line)).toBe(1000);
  });

  it("home totals: headline, chart and feed ignore extras", () => {
    const line = buildLine([claim(A, 1000), claim(B, 2000)], [paid, extra]);
    const t = computeTotals(null, line, [paid, extra]);
    expect(t.paidCents).toBe(1000);
    expect(t.feed.map((f) => f.href)).toEqual(["https://basescan.org/tx/0xp"]);
  });

  it("reads rows from before sql/005 (no kind) as paid, and a stored extra as extra", async () => {
    const f = db({
      payments: [
        { tx_hash: "0xp", to_address: A, amount_units: "10000000", block_time: "2026-10-11T00:00:00Z" },
        { tx_hash: "0xe", to_address: B, amount_units: "5000000", block_time: "2026-10-11T00:00:00Z", kind: "extra" },
      ],
    });
    const { line, payments } = await loadLineData(f.db as SupabaseClient);
    expect(payments.map((p) => p.kind)).toEqual(["paid", "extra"]);
    expect(line.find((e) => e.pid === PID[A])!.status).toBe("paid");
    expect(line.find((e) => e.pid === PID[B])!).toMatchObject({ status: "waiting", extras: [{ cents: 500, txHash: "0xe" }] });
  });
});

describe("extras can not crowd out counted payments", () => {
  it("a flood of newer extras leaves paid totals alone and is capped per person and overall", async () => {
    const flood = Array.from({ length: 5000 }, (_, i) => ({
      tx_hash: `0xe${i}`,
      to_address: [A, B, C][i % 3],
      amount_units: "1000000",
      block_time: `2026-10-11T${String(Math.floor(i / 3600) % 24).padStart(2, "0")}:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`,
      kind: "extra",
    }));
    // The counted payment is stored last, after 5000 extras, so a single capped read would miss it.
    const f = db({ payments: [...flood, { tx_hash: "0xp", to_address: A, amount_units: "10000000", block_time: "2026-10-10T12:00:00Z", kind: "paid" }] });
    const { line, payments } = await loadLineData(f.db);
    expect(line.find((e) => e.pid === PID[A])!.status).toBe("paid");
    expect(paidFromLine(line)).toBe(1000);
    expect(computeTotals(null, line, payments).paidCents).toBe(1000);
    const extras = payments.filter((p) => p.kind === "extra");
    expect(extras.length).toBeLessThanOrEqual(EXTRAS_READ_LIMIT);
    for (const a of [A, B, C]) expect(extras.filter((p) => p.to_address === a)).toHaveLength(EXTRAS_PER_ADDRESS);
    // Newest first: the extras kept are the latest ones.
    expect(extras[0]!.block_time >= extras[extras.length - 1]!.block_time).toBe(true);
  });

  it("before sql/005 (no kind column) reads every row as counted", async () => {
    current = fakeDb(
      { pledger_payments: [{ tx_hash: "0x1", to_address: A, amount_units: "10000000", block_time: "2026-10-11T00:00:00Z" }] },
      {},
      { columns: { pledger_payments: ["tx_hash", "to_address", "amount_units", "block_number", "block_time"] } },
    );
    expect((await readPayments(current.db)).map((p) => [p.tx_hash, p.kind])).toEqual([["0x1", "paid"]]);
  });
});

describe("isMissingSchema", () => {
  it("matches on the code only, never on the message", () => {
    for (const code of ["PGRST204", "PGRST205", "42703", "42P01"]) expect(isMissingSchema({ code })).toBe(true);
    expect(isMissingSchema({ code: "57014", message: "relation does not exist in the schema cache" } as { code: string })).toBe(false);
    expect(isMissingSchema({ code: "", message: "Could not find the table in the schema cache" } as { code: string })).toBe(false);
    expect(isMissingSchema(null)).toBe(false);
  });
});
