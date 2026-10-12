import { describe, expect, it } from "vitest";
import data from "../src/content/zcash-pledge.testnet.json";
import mainData from "../src/content/zcash-pledge.mainnet.json";
import { KIND_LABEL, ZCASH, ZCASH_BY_NET, ZCASH_MAINNET, ZCASH_SLUG, formatZat, getPledge, getPledges, zcashMainnetRisks, zcashPledge, zcashVerifyCommand, zcashVerifyDisplay, type ZcashPledgeData } from "@/lib/pledges";

describe("Zcash testnet pledge", () => {
  it("loads the JSON with the facts from the spike", () => {
    expect(ZCASH).toEqual({ ...data, networkId: "testnet", published: true });
    expect(ZCASH.network).toBe("Zcash testnet");
    expect(ZCASH.viewingKey).toMatch(/^uviewtest1[a-z0-9]+$/);
    expect(ZCASH.address).toMatch(/^utest1[a-z0-9]+$/);
    expect(ZCASH.birthdayHeight).toBe(4492700);
    expect(ZCASH.pledgeTx!.block).toBe(4492820);
    expect(ZCASH.outgoingTx!.block).toBe(4492867);
    // Balance = pledge in, minus the test payment out, minus its fee.
    expect(ZCASH.balanceZat).toBe(ZCASH.pledgeTx!.amountZat - ZCASH.outgoingTx!.amountZat - ZCASH.outgoingTx!.feeZat);
    expect(ZCASH.verifiedBlock).toBeGreaterThanOrEqual(ZCASH.outgoingTx!.block);
    expect(Number.isNaN(Date.parse(ZCASH.verifiedAt!))).toBe(false);
  });

  it("resolves the slug, ranks third and is labelled testnet", () => {
    const p = getPledge(ZCASH_SLUG);
    expect(p).toBeDefined();
    expect(p!.testnet).toBe(true);
    expect(p!.chain).toBe("Zcash testnet");
    expect(KIND_LABEL[p!.kind]).toBe("Zcash");
    expect(getPledges().map((x) => x.slug)).toEqual(["test-match-pool", "artizen-give-back", ZCASH_SLUG]);
    expect(p!.inPlace.find((r) => r.label === "In place now (snapshot)")?.value).toBe("0.1239 TAZ (Zcash test money)");
    // No bare ticker on first use: header and home card both name the unit in words.
    expect(p!.stats[0]).toEqual({ value: "0.1239 TAZ (Zcash test money)", label: "in place now (snapshot)" });
    expect(p!.cardStats![0]).toEqual({ value: "0.1239 TAZ (Zcash test money)", label: "in place now (snapshot)" });
    expect(p!.howItWorks).toContain("The key also shows payments going out, including where they went.");
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
    const text = JSON.stringify({ p, data, mainData, m: zcashPledge(ZCASH_MAINNET), risks: zcashMainnetRisks(ZCASH_MAINNET) });
    expect(text).not.toMatch(/—|&mdash;/);
    expect(text).not.toMatch(/Artizen|Tempo/i);
  });
});

// A made-up published mainnet snapshot, shaped like the testnet facts, to check the derived strings.
const fakeMain: ZcashPledgeData = {
  ...ZCASH_MAINNET,
  published: true,
  address: "u1fakeaddress",
  viewingKey: "uview1fakekey",
  birthdayHeight: 3_100_000,
  balanceZat: 50_000_000,
  pledgeTx: { txid: "a".repeat(64), block: 3_100_100, date: "2026-11-01", amountZat: 50_010_000, feeZat: 10_000 },
  verifiedAt: "2026-11-02T10:00:00Z",
  verifiedBlock: 3_100_500,
};

describe("Zcash mainnet pledge", () => {
  it("loads the mainnet JSON as unpublished placeholders", () => {
    expect(ZCASH_BY_NET.mainnet).toBe(ZCASH_MAINNET);
    expect(ZCASH_BY_NET.testnet).toBe(ZCASH);
    expect(ZCASH_MAINNET).toMatchObject({ networkId: "mainnet", network: "Zcash mainnet", unit: "ZEC", published: false, pool: "Ironwood" });
    expect(ZCASH_MAINNET.address).toBeNull();
    expect(ZCASH_MAINNET.viewingKey).toBeNull();
    expect(ZCASH_MAINNET.birthdayHeight).toBeNull();
    expect(ZCASH_MAINNET.balanceZat).toBeNull();
    expect(ZCASH_MAINNET.explorerTxUrl).toBe("https://zecblock.com/tx/");
    expect(ZCASH_MAINNET.indexer).toBe("https://zec.rocks:443");
  });

  it("renders no numbers while unpublished", () => {
    const p = zcashPledge(ZCASH_MAINNET);
    expect(p.slug).toBe(ZCASH_SLUG);
    expect(p.chain).toBe("Zcash mainnet");
    expect(p.testnet).toBe(false);
    expect(p.activity).toEqual([]);
    expect(p.checkedOn).toBeUndefined();
    // Shown text only (the boolean testnet flag is not copy).
    const text = JSON.stringify({ ...p, testnet: undefined });
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/test money|testnet|TAZ/i);
  });

  it("derives every string from published mainnet data, in ZEC, without test-money wording", () => {
    const p = zcashPledge(fakeMain);
    const text = JSON.stringify({ ...p, testnet: undefined });
    expect(text).not.toMatch(/test money|testnet|faucet|TAZ/i);
    expect(p.stats[0]!.value).toBe("0.5 ZEC (Zcash)");
    expect(p.activity).toHaveLength(1); // only the pledge tx exists; no outgoing tx
    expect(p.activity[0]).toMatchObject({ text: "Pledge funded", amount: "0.5001 ZEC", href: "https://zecblock.com/tx/" + "a".repeat(64) });
    expect(p.howItWorks[0]).toBe("The funder sends money to a private Zcash address. This one holds 0.5001 ZEC.");
    expect(p.inPlace.find((r) => r.label === "Pool")?.value).toBe("Ironwood");
    expect(p.checkedOn).toBe("2 Nov 2026");
  });

  it("builds the mainnet verify command against zec.rocks", () => {
    const cmd = zcashVerifyCommand(fakeMain);
    expect(cmd).toBe("zingo-cli --chain mainnet --server https://zec.rocks:443 --viewkey uview1fakekey --birthday 3100000 --waitsync balance");
    expect(zcashVerifyDisplay(fakeMain)).toContain("--viewkey <viewing key> --birthday 3100000");
    // Testnet command is unchanged.
    expect(zcashVerifyDisplay(ZCASH)).toBe(ZCASH.verifyCommand.replace("<UFVK>", "<viewing key>"));
  });

  it("fills the risk list from the data", () => {
    const risks = zcashMainnetRisks(fakeMain);
    expect(risks[0]).toBe("This is real money (ZEC), not test money.");
    expect(risks).toContain("No external audit. The balance is a snapshot as of block 3,100,500, not live.");
    expect(risks).toContain("Funds sit in Zcash's Ironwood pool, live since 28 Jul 2026.");
    expect(risks).toHaveLength(8);
  });

  it("keeps the testnet pledge as the home card", () => {
    expect(getPledge(ZCASH_SLUG)!.chain).toBe("Zcash testnet");
  });
});
