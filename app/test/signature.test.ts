import { describe, expect, it } from "vitest";
import { verifyMessage } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkClaimSignature, claimMessage, type ClaimPayload, type SignatureVerifier } from "@/lib/claims";

// Fresh random keys per run; nothing is stored.
const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const verify: SignatureVerifier = (a) => verifyMessage(a);

const fpA = "a".repeat(64);
const fpB = "b".repeat(64);
const now = 1_760_000_000_000;

function payload(over: Partial<ClaimPayload> = {}): ClaimPayload {
  return { fingerprints: [fpB, fpA], payout: account.address, display: { mode: "initials", name: " Ana  Ortiz " }, timestamp: now, ...over };
}

describe("claim signature", () => {
  it("accepts a valid signature from the payout wallet, regardless of key/fingerprint order", async () => {
    const p = payload();
    const signature = await account.signMessage({ message: claimMessage(p) });
    const reordered = { ...p, fingerprints: [fpA, fpB], payout: account.address.toLowerCase() };
    const r = await checkClaimSignature({ payload: reordered, signature, address: account.address, verifiedFingerprints: [fpA, fpB], now: now + 1000, verify });
    expect(r).toEqual({ ok: true });
  });

  it("message is canonical JSON with sorted keys", () => {
    const m = claimMessage(payload());
    expect(m.split("\n")[1]).toBe(
      `{"display":{"mode":"initials","name":"Ana Ortiz"},"fingerprints":["${fpA}","${fpB}"],"payout":"${account.address.toLowerCase()}","timestamp":${now}}`,
    );
  });

  it("rejects a signature from another wallet", async () => {
    const p = payload();
    const signature = await other.signMessage({ message: claimMessage(p) });
    const r = await checkClaimSignature({ payload: p, signature, address: account.address, verifiedFingerprints: [fpA, fpB], now, verify });
    expect(r).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects when the server's verified fingerprints differ from the signed ones", async () => {
    const p = payload();
    const signature = await account.signMessage({ message: claimMessage(p) });
    const r = await checkClaimSignature({ payload: p, signature, address: account.address, verifiedFingerprints: [fpA], now, verify });
    expect(r).toEqual({ ok: false, reason: "fingerprints-mismatch" });
  });

  it("rejects an expired timestamp and a payout that is not the signer", async () => {
    const p = payload();
    const signature = await account.signMessage({ message: claimMessage(p) });
    expect(await checkClaimSignature({ payload: p, signature, address: account.address, verifiedFingerprints: [fpA, fpB], now: now + 11 * 60_000, verify })).toEqual({
      ok: false,
      reason: "signature-expired",
    });
    expect(await checkClaimSignature({ payload: p, signature, address: other.address, verifiedFingerprints: [fpA, fpB], now, verify })).toEqual({
      ok: false,
      reason: "payout-mismatch",
    });
  });

  it("rejects a tampered display name", async () => {
    const p = payload();
    const signature = await account.signMessage({ message: claimMessage(p) });
    const tampered = { ...p, display: { mode: "full" as const, name: "Someone Else" } };
    const r = await checkClaimSignature({ payload: tampered, signature, address: account.address, verifiedFingerprints: [fpA, fpB], now, verify });
    expect(r).toEqual({ ok: false, reason: "bad-signature" });
  });
});
