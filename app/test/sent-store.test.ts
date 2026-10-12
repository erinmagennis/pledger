import { describe, expect, it } from "vitest";
import {
  HOLD_CHUNK,
  SENT_MAX_AGE,
  addCalls,
  addSent,
  chunk,
  hold,
  parseCalls,
  parseSent,
  pruneCalls,
  pruneSent,
  sentId,
  serializeSent,
  worthRetrying,
  type BatchTransfer,
  type SentCalls,
  type SentTx,
} from "@/components/claim/holds";
import { TOO_MANY } from "@/lib/ratelimit";
import { NEEDS_003 } from "@/lib/payments-server";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const sent = (address: string, tx: string, at = NOW): SentTx => ({ from: "help", pid: "p-" + address.slice(2, 3), address, amountUnits: "5000000", txs: [tx], label: "A. A.", at });

describe("a failed record worth checking again (Help pay and Pay keep the item pending)", () => {
  it("keeps a 429 pending", () => expect(worthRetrying(429, TOO_MANY)).toBe(true));
  it("keeps the 003 answer pending", () => expect(worthRetrying(409, NEEDS_003)).toBe(true));
  it("keeps a server error and a tx not on Base yet pending", () => {
    expect(worthRetrying(503, "Database not connected yet")).toBe(true);
    expect(worthRetrying(400, "Transaction not found on Base yet. Wait a minute and try again.")).toBe(true);
  });
  it("drops a rule rejection", () => {
    expect(worthRetrying(400, "Does not match what is owed ($15.00)")).toBe(false);
    expect(worthRetrying(400, "No USDC payment to this person in that transaction")).toBe(false);
    expect(worthRetrying(404, "This address is not in line")).toBe(false);
  });
});

describe("sent txs kept in this browser", () => {
  it("round-trips through storage text", () => {
    const list = [sent(A, "0x1"), { ...sent(B, "0x2"), txs: ["0x2", "0x3"], from: "pay" as const }];
    expect(parseSent(serializeSent(list), NOW)).toEqual(list);
  });

  it("reads nothing from empty, broken or wrong-shaped text", () => {
    expect(parseSent(null, NOW)).toEqual([]);
    expect(parseSent("{not json", NOW)).toEqual([]);
    expect(parseSent('{"a":1}', NOW)).toEqual([]);
    expect(parseSent(JSON.stringify([{ address: A }, sent(A, "0x1"), { ...sent(B, "0x2"), txs: [] }]), NOW)).toEqual([sent(A, "0x1")]);
  });

  it("leaves out entries older than SENT_MAX_AGE", () => {
    const old = sent(A, "0x1", NOW - SENT_MAX_AGE - 1);
    expect(parseSent(serializeSent([old, sent(B, "0x2")]), NOW)).toEqual([sent(B, "0x2")]);
  });

  it("adds without duplicating the same person and first hash", () => {
    const list = addSent([sent(A, "0x1")], [{ ...sent(A, "0x1"), amountUnits: "6000000" }, sent(B, "0x2")]);
    expect(list.map(sentId)).toEqual([`${A}:0x1`, `${B}:0x2`]);
    expect(list[0]!.amountUnits).toBe("6000000");
  });

  it("prunes recorded or turned-away ids and old entries, keeps the rest", () => {
    const list = [sent(A, "0x1"), sent(B, "0x2"), sent(B, "0x3", NOW - SENT_MAX_AGE - 1)];
    expect(pruneSent(list, [sentId(sent(A, "0x1"))], NOW)).toEqual([sent(B, "0x2")]);
  });

  it("matches ids case-insensitively", () => {
    expect(sentId({ address: A.toUpperCase().replace("0X", "0x"), txs: ["0xAB"] })).toBe(sentId({ address: A, txs: ["0xab"] }));
  });
});

describe("holds go out in groups of 10", () => {
  it("splits in order", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
  });

  it("holds all 23 people, three requests, not only the first 10", async () => {
    const bodies: string[][] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      const { pids } = JSON.parse(init.body) as { pids: string[] };
      bodies.push(pids);
      return new Response(JSON.stringify({ held: true, until: "2026-10-12T12:10:00Z", pids }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const pids = Array.from({ length: 23 }, (_, i) => `p${i}`);
      const r = await hold([...pids, "p0", ""], "pledger");
      expect(r.held).toBe(true);
      expect(bodies.map((b) => b.length)).toEqual([HOLD_CHUNK, HOLD_CHUNK, 3]);
      expect(bodies.flat()).toEqual(pids);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("still says held when a later group fails", async () => {
    const real = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async () =>
      n++ === 0 ? new Response(JSON.stringify({ held: true, until: "2026-10-12T12:10:00Z" }), { status: 200 }) : new Response("{}", { status: 429 })) as unknown as typeof fetch;
    try {
      const r = await hold(Array.from({ length: 12 }, (_, i) => `q${i}`), "pledger");
      expect(r).toEqual({ held: true, until: "2026-10-12T12:10:00Z" });
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("wallet batches kept before Base answers", () => {
  const t = (address: string): BatchTransfer => ({ pid: "p", address, shortAddress: "0xaa…aa", label: "A. A.", places: [1], amountUnits: "5000000", amountCents: 500 });
  const calls = (id: string, at = NOW): SentCalls => ({ id, list: [t(A), t(B)], at });

  it("round-trips and drops malformed or old batches", () => {
    const list = [calls("c1"), calls("c2")];
    expect(parseCalls(JSON.stringify(list), NOW)).toEqual(list);
    expect(parseCalls(null, NOW)).toEqual([]);
    expect(parseCalls("{nope", NOW)).toEqual([]);
    expect(parseCalls(JSON.stringify([{ id: "x", list: [], at: NOW }, { ...calls("c3"), list: [{ address: A }] }, calls("old", NOW - SENT_MAX_AGE - 1), calls("c4")]), NOW)).toEqual([calls("c4")]);
  });

  it("adds by id without duplicates, and prunes one id", () => {
    const list = addCalls(addCalls([calls("c1")], calls("c2")), { ...calls("c1"), at: NOW + 1 });
    expect(list.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(pruneCalls(list, "c2", NOW).map((c) => c.id)).toEqual(["c1"]);
  });

  it("two tabs that each add a batch keep both (each write starts from what is stored)", () => {
    const stored = JSON.stringify(addCalls(parseCalls(null, NOW), calls("tab1")));
    const after = addCalls(parseCalls(stored, NOW), calls("tab2"));
    expect(after.map((c) => c.id)).toEqual(["tab1", "tab2"]);
  });
});
