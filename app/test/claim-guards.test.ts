import { describe, expect, it, vi } from "vitest";
import { friendlyReason, nameProblem, NO_FEE } from "@/lib/claims";
import { STUCK_MS, recordClaims, retryable, type RecordInput } from "@/lib/eas";
import { checkUploads } from "@/lib/claims-server";
import { fakeDb } from "./fake-db";

// Stand-in verifier: the file body is the endowment fee in dollars.
vi.mock("@/lib/verify", () => ({
  MAX_BYTES: 2 * 1024 * 1024,
  verifyArtizenEmail: async (raw: Buffer) => ({
    ok: true,
    kind: "receipt",
    fingerprint: raw.toString().padStart(64, "f"),
    to: "a@example.com",
    date: "2026-08-01",
    project: "P",
    endowmentFee: Number(raw.toString()),
  }),
  pairSelfBacked: (receipts: unknown[]) => ({ receipts: receipts.map((r) => ({ ...(r as object), selfBacked: false })) }),
}));

describe("$0 receipts", () => {
  it("are marked not claimable with a plain message", async () => {
    const rows = await checkUploads([{ name: "zero.eml", data: Buffer.from("0") }, { name: "ten.eml", data: Buffer.from("10") }], null);
    expect(rows[0]).toMatchObject({ ok: false, reason: "no-fee", message: "This receipt has no endowment fee", feeCents: 0 });
    expect(rows[1]).toMatchObject({ ok: true, feeCents: 1000 });
    expect(friendlyReason("no-fee").message).toBe(NO_FEE);
  });
});

describe("public display names", () => {
  it("allows names in any script with . ' -", () => {
    for (const n of ["Ana Ortiz", "A. O.", "O'Brien", "O’Brien", "Jean-Luc", "Zoë Ñúñez", "李小龍", "Studio 10x", "O. Neal", "St. Ann", "J.R.R. Tolkien"]) expect(nameProblem(n)).toBeNull();
  });

  it("rejects wallets, links, emails and domain-like text", () => {
    for (const n of ["0xAbC123", "send to 0x1234", "http example", "www example", "visit example.com", "pay.me now", "Ana.io", "pledger.com", "my-site.co.uk"]) {
      expect(nameProblem(n)).toBe("A name cannot include a link, email or wallet address");
    }
  });

  it("rejects other symbols and names over 60 characters", () => {
    expect(nameProblem("ana@example")).toBe("Use only letters, numbers, spaces and . ' -");
    expect(nameProblem("https://x")).toBe("Use only letters, numbers, spaces and . ' -");
    expect(nameProblem("a".repeat(61))).toBe("Keep the name to 60 characters or fewer");
    expect(nameProblem("a".repeat(60))).toBeNull();
  });
});

describe("paid attestations are written once", () => {
  const input = (id: string): RecordInput => ({ claimId: id, fingerprint: "ab", project: "P", feeCents: 100, selfBacked: false, status: "paid", recipient: "0xa" });
  const recorded = async () => ({ state: "recorded" as const, uid: "0xuid" });

  const UNIQUE = { pledger_attestations: ["claim_id", "status"] };

  it("skips claims that already have a paid record", async () => {
    const f = fakeDb({ pledger_attestations: [{ claim_id: "c1", status: "paid" }], pledger_claims: [{ id: "c1" }, { id: "c2" }] }, UNIQUE);
    const attest = vi.fn(recorded);
    await recordClaims(f.db, [input("c1"), input("c2")], attest);
    expect(attest.mock.calls.map((c) => c[0].claimId)).toEqual(["c2"]);
    expect(f.tables.pledger_attestations).toHaveLength(2);
  });

  it("claims the slot before attesting, so two racing checks attest once (sql/004)", async () => {
    const f = fakeDb({ pledger_attestations: [], pledger_claims: [{ id: "c1" }] }, UNIQUE);
    const attest = vi.fn(recorded);
    await Promise.all([recordClaims(f.db, [input("c1")], attest), recordClaims(f.db, [input("c1")], attest)]);
    expect(attest).toHaveBeenCalledTimes(1);
    expect(f.tables.pledger_attestations).toEqual([{ claim_id: "c1", fingerprint: "ab", status: "paid", state: "recorded", uid: "0xuid", tx_hash: null, error: null }]);
    expect(f.tables.pledger_claims![0]!.record_state).toBe("recorded");
  });

  it("keeps the placeholder as pending with the error when the attestation fails", async () => {
    const f = fakeDb({ pledger_attestations: [], pledger_claims: [{ id: "c1" }] }, UNIQUE);
    await recordClaims(f.db, [input("c1")], async () => ({ state: "pending" as const, error: "rpc down" }));
    expect(f.tables.pledger_attestations![0]).toMatchObject({ state: "pending", uid: null, error: "rpc down" });
    expect(f.tables.pledger_claims![0]!.record_state).toBe("pending");
  });

  it("retries a pending row in place on the next call, and it becomes recorded", async () => {
    const f = fakeDb({ pledger_attestations: [], pledger_claims: [{ id: "c1" }] }, UNIQUE);
    await recordClaims(f.db, [input("c1")], async () => ({ state: "pending" as const, error: "rpc down" }));
    const attest = vi.fn(async () => ({ state: "recorded" as const, uid: "0xuid", txHash: "0xtx" }));
    await recordClaims(f.db, [input("c1")], attest);
    expect(attest).toHaveBeenCalledTimes(1);
    expect(f.tables.pledger_attestations).toEqual([{ claim_id: "c1", fingerprint: "ab", status: "paid", state: "recorded", uid: "0xuid", tx_hash: "0xtx", error: null }]);
    expect(f.tables.pledger_claims![0]!.record_state).toBe("recorded");
  });

  it("never attests a recorded row again", async () => {
    const f = fakeDb({ pledger_attestations: [{ claim_id: "c1", status: "paid", state: "recorded", uid: "0xold", error: null }], pledger_claims: [{ id: "c1" }] }, UNIQUE);
    const attest = vi.fn(recorded);
    await recordClaims(f.db, [input("c1")], attest);
    expect(attest).not.toHaveBeenCalled();
    expect(f.tables.pledger_attestations![0]).toMatchObject({ state: "recorded", uid: "0xold" });
  });

  it("leaves a fresh placeholder to the request that made it, and retries one stuck past STUCK_MS", async () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    const row = (createdAt: string) => ({ claim_id: "c1", status: "paid", state: "pending", uid: null, error: null, created_at: createdAt });
    const fresh = fakeDb({ pledger_attestations: [row("2026-10-12T11:59:00Z")], pledger_claims: [{ id: "c1" }] }, UNIQUE);
    const attest = vi.fn(recorded);
    await recordClaims(fresh.db, [input("c1")], attest, now);
    expect(attest).not.toHaveBeenCalled();
    const stuck = fakeDb({ pledger_attestations: [row(new Date(now - STUCK_MS - 1000).toISOString())], pledger_claims: [{ id: "c1" }] }, UNIQUE);
    await recordClaims(stuck.db, [input("c1")], attest, now);
    expect(attest).toHaveBeenCalledTimes(1);
    expect(stuck.tables.pledger_attestations![0]).toMatchObject({ state: "recorded", uid: "0xuid" });
  });

  it("two racing retries of one pending row attest once", async () => {
    const f = fakeDb({ pledger_attestations: [{ claim_id: "c1", status: "paid", state: "pending", uid: null, error: "rpc down" }], pledger_claims: [{ id: "c1" }] }, UNIQUE);
    const attest = vi.fn(recorded);
    await Promise.all([recordClaims(f.db, [input("c1")], attest), recordClaims(f.db, [input("c1")], attest)]);
    expect(attest).toHaveBeenCalledTimes(1);
    expect(f.tables.pledger_attestations![0]).toMatchObject({ state: "recorded" });
  });

  it("decides what to retry from the row alone", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    expect(retryable({ state: "recorded", error: null }, now)).toBe(false);
    expect(retryable({ state: "pending", error: "rpc down" }, now)).toBe(true);
    expect(retryable({ state: "pending", error: null, created_at: "2026-10-12T11:55:00Z" }, now)).toBe(false);
    expect(retryable({ state: "pending", error: null, created_at: "2026-10-12T11:45:00Z" }, now)).toBe(true);
    expect(retryable({ state: "pending", error: "retrying since 2026-10-12T11:55:00.000Z" }, now)).toBe(false);
    expect(retryable({ state: "pending", error: "retrying since 2026-10-12T11:45:00.000Z" }, now)).toBe(true);
  });
});
