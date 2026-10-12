import { describe, expect, it } from "vitest";
import { SENT_MAX_AGE, addSent, parseSent, pruneSent, sentId, serializeSent, worthRetrying, type SentTx } from "@/components/claim/holds";
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
