import { describe, expect, it, vi } from "vitest";
import { displayLabel, friendlyReason, markUnclaimable, parseExcludedHashes, summarize } from "@/lib/claims";
import { existingFingerprints, hashEmail } from "@/lib/claims-server";

const f = (c: string) => c.repeat(64);

describe("duplicate and exclusion rules", () => {
  const owner = hashEmail("  Owner@Example.com ");
  const rows = [
    { ok: true, kind: "receipt", fingerprint: f("1"), toHash: hashEmail("a@x.io") },
    { ok: true, kind: "receipt", fingerprint: f("2"), toHash: hashEmail("a@x.io") },
    { ok: true, kind: "receipt", fingerprint: f("1"), toHash: hashEmail("a@x.io") },
    { ok: true, kind: "receipt", fingerprint: f("3"), toHash: owner },
    { ok: true, kind: "sold", fingerprint: f("4"), toHash: owner },
    { ok: false, kind: "receipt", reason: "dkim-fail", fingerprint: f("5") },
  ];

  it("rejects stored fingerprints, repeats in one upload, and the excluded owner's receipts", () => {
    const out = markUnclaimable(rows, new Set([f("2")]), parseExcludedHashes(`${owner}, not-a-hash`));
    expect(out.map((r) => [r.ok, r.reason])).toEqual([
      [true, undefined],
      [false, "duplicate"],
      [false, "duplicate-upload"],
      [false, "excluded"],
      [true, undefined], // sold emails are never money, so the owner exclusion does not apply
      [false, "dkim-fail"],
    ]);
  });

  it("hashes emails lowercased and trimmed", () => {
    expect(owner).toBe(hashEmail("owner@example.com"));
    expect(owner).toMatch(/^[0-9a-f]{64}$/);
  });

  it("looks up existing fingerprints through the db (mocked)", async () => {
    const inFn = vi.fn().mockResolvedValue({ data: [{ fingerprint: f("2") }], error: null });
    const db = { from: vi.fn(() => ({ select: vi.fn(() => ({ in: inFn })) })) };
    const got = await existingFingerprints(db as never, [f("1"), f("2")]);
    expect([...got]).toEqual([f("2")]);
    expect(db.from).toHaveBeenCalledWith("pledger_claims");
    expect(inFn).toHaveBeenCalledWith("fingerprint", [f("1"), f("2")]);
    expect(await existingFingerprints(null, [f("1")])).toEqual(new Set());
  });

  it("maps reasons to plain messages", () => {
    expect(friendlyReason("dkim-fail")).toEqual({ message: "Download the original email from your inbox", showHelp: true });
    expect(friendlyReason("from-not-artizen").showHelp).toBe(true);
    expect(friendlyReason("outside-season").message).toBe("Season 7 only for now");
    expect(friendlyReason("duplicate").message).toBe("Already claimed");
  });

  it("summarizes self-backed and other fees", () => {
    const s = summarize([
      { file: "a", kind: "receipt", ok: true, feeCents: 1000, selfBacked: true },
      { file: "b", kind: "receipt", ok: true, feeCents: 250 },
      { file: "c", kind: "receipt", ok: false, feeCents: 999 },
      { file: "d", kind: "sold", ok: true },
    ]);
    expect(s).toEqual({ selfBackedCents: 1000, otherCents: 250, totalCents: 1250, claimable: 2 });
  });

  it("builds display labels", () => {
    expect(displayLabel("initials", "ana maría ortiz")).toBe("A. M. O.");
    expect(displayLabel("full", "  Ana   Ortiz ")).toBe("Ana Ortiz");
    expect(displayLabel("project", "")).toBeNull();
    expect(() => displayLabel("full", " ")).toThrow();
  });
});
