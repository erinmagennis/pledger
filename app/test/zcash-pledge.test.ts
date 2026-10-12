import { describe, expect, it } from "vitest";
import data from "../src/content/zcash-pledge.json";
import { KIND_LABEL, ZCASH, ZCASH_SLUG, formatZat, getPledge, getPledges, zcashVerifyCommand } from "@/lib/pledges";

describe("Zcash testnet pledge", () => {
  it("loads the JSON with the facts from the spike", () => {
    expect(ZCASH).toEqual(data);
    expect(ZCASH.network).toBe("Zcash testnet");
    expect(ZCASH.viewingKey).toMatch(/^uviewtest1[a-z0-9]+$/);
    expect(ZCASH.address).toMatch(/^utest1[a-z0-9]+$/);
    expect(ZCASH.birthdayHeight).toBe(4492700);
    expect(ZCASH.pledgeTx.block).toBe(4492820);
    expect(ZCASH.outgoingTx.block).toBe(4492867);
    // Balance = pledge in, minus the test payment out, minus its fee.
    expect(ZCASH.balanceZat).toBe(ZCASH.pledgeTx.amountZat - ZCASH.outgoingTx.amountZat - ZCASH.outgoingTx.feeZat);
    expect(ZCASH.verifiedBlock).toBeGreaterThanOrEqual(ZCASH.outgoingTx.block);
    expect(Number.isNaN(Date.parse(ZCASH.verifiedAt))).toBe(false);
  });

  it("resolves the slug, ranks third and is labelled testnet", () => {
    const p = getPledge(ZCASH_SLUG);
    expect(p).toBeDefined();
    expect(p!.testnet).toBe(true);
    expect(p!.chain).toBe("Zcash testnet");
    expect(KIND_LABEL[p!.kind]).toBe("Private funder");
    expect(getPledges().map((x) => x.slug)).toEqual(["test-match-pool", "artizen-give-back", ZCASH_SLUG]);
    expect(p!.inPlace.find((r) => r.label === "In place now")?.value).toBe("0.1239 TAZ (testnet)");
    expect(p!.activity.every((a) => a.href?.startsWith("https://testnet.cipherscan.app/tx/"))).toBe(true);
  });

  it("formats zat as TAZ", () => {
    expect(formatZat(ZCASH.balanceZat)).toBe("0.1239 TAZ");
    expect(formatZat(12_500_000)).toBe("0.125 TAZ");
    expect(formatZat(10_000)).toBe("0.0001 TAZ");
    expect(formatZat(100_000_000)).toBe("1 TAZ");
  });

  it("puts the full key in the verify command", () => {
    const cmd = zcashVerifyCommand();
    expect(cmd).toContain(`--viewkey ${ZCASH.viewingKey} `);
    expect(cmd).toContain("--birthday 4492700");
    expect(cmd).not.toContain("<UFVK>");
  });

  it("keeps the copy free of em dashes, Artizen and Tempo", () => {
    const p = getPledge(ZCASH_SLUG)!;
    const text = JSON.stringify({ p, data });
    expect(text).not.toMatch(/—|&mdash;/);
    expect(text).not.toMatch(/Artizen|Tempo/i);
  });
});
