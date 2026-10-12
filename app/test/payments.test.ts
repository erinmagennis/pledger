import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseTxHash, sumUsdcTransfersTo, type ReceiptLike } from "@/lib/base";
import { unitsToCents } from "@/lib/claims";

const receipt = JSON.parse(readFileSync(new URL("./fixtures/base-usdc-receipt.json", import.meta.url), "utf8")) as ReceiptLike;
const CLAIMANT = "0xAbCdEfabcdefabcdefabcdefabcdefabcdefABCD";

describe("Base USDC payment parsing", () => {
  it("sums every USDC Transfer to the claimant (batch payout), ignoring other tokens, events and recipients", () => {
    const units = sumUsdcTransfersTo(receipt, CLAIMANT);
    expect(units).toBe(5_000_000n + 2_000_000n); // $5 + $2
    expect(unitsToCents(units)).toBe(700);
  });

  it("counts the other recipient separately", () => {
    expect(sumUsdcTransfersTo(receipt, "0x3333333333333333333333333333333333333333")).toBe(10_000_000n);
  });

  it("returns 0 for an address with no transfer and for a reverted tx", () => {
    expect(sumUsdcTransfersTo(receipt, "0x4444444444444444444444444444444444444444")).toBe(0n);
    expect(sumUsdcTransfersTo({ ...receipt, status: "reverted" }, CLAIMANT)).toBe(0n);
  });

  it("reads a tx hash from a Basescan link or a bare hash", () => {
    const h = "0x5d3c0f3b2b1a6f1e7a0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a";
    expect(parseTxHash(`https://basescan.org/tx/${h.toUpperCase().replace("0X", "0x")}`)).toBe(h);
    expect(parseTxHash(` ${h} `)).toBe(h);
    expect(parseTxHash("https://basescan.org/address/0x1234")).toBeNull();
  });
});
