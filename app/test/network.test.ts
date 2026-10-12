import { describe, expect, it } from "vitest";
import { CONSENT_KEY, DEFAULT_NET, NET_KEY, needsConsent, parseNet, readConsent, readNet, resolveNet, writeConsent, writeNet, type NetStorage } from "@/lib/network";
import { MAINNET_CHECKBOX, MAINNET_WARNING } from "@/components/NetSwitch";

function mem(init: Record<string, string> = {}): NetStorage & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k]! : null), setItem: (k, v) => void (data[k] = v) };
}

const broken: NetStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("network choice", () => {
  it("defaults to testnet", () => {
    expect(DEFAULT_NET).toBe("testnet");
    expect(readNet(mem())).toBe("testnet");
    expect(readNet(null)).toBe("testnet");
  });

  it("parses only the exact string mainnet", () => {
    expect(parseNet("mainnet")).toBe("mainnet");
    for (const v of ["testnet", "Mainnet", " mainnet", "", null, undefined, 1]) expect(parseNet(v)).toBe("testnet");
  });

  it("needs the consent flag before mainnet sticks", () => {
    expect(resolveNet("mainnet", null)).toBe("testnet");
    expect(resolveNet("mainnet", "0")).toBe("testnet");
    expect(resolveNet("mainnet", "1")).toBe("mainnet");
    expect(readNet(mem({ [NET_KEY]: "mainnet" }))).toBe("testnet");
    expect(readNet(mem({ [NET_KEY]: "mainnet", [CONSENT_KEY]: "1" }))).toBe("mainnet");
    expect(needsConsent("mainnet", null)).toBe(true);
    expect(needsConsent("mainnet", "1")).toBe(false);
    expect(needsConsent("testnet", null)).toBe(false);
  });

  it("writes the keys pledger.net and pledger.net.consent", () => {
    const s = mem();
    writeConsent(s);
    writeNet("mainnet", s);
    expect(s.data).toEqual({ "pledger.net": "mainnet", "pledger.net.consent": "1" });
    expect(readConsent(s)).toBe(true);
    expect(readNet(s)).toBe("mainnet");
    writeNet("testnet", s);
    expect(readNet(s)).toBe("testnet");
  });

  it("survives blocked storage", () => {
    expect(() => writeNet("mainnet", broken)).not.toThrow();
    expect(() => writeConsent(broken)).not.toThrow();
    expect(readNet(broken)).toBe("testnet");
    expect(readConsent(broken)).toBe(false);
  });

  it("keeps the approved warning verbatim and free of em dashes", () => {
    expect(MAINNET_WARNING).toBe(
      "You are switching to real money. Pledger has not had an external audit. Contracts and code are public and tested, but a bug could lose funds. Pledger never holds money, so losses would be from your own wallet. Testnet is the safe default.",
    );
    expect(MAINNET_CHECKBOX).toBe("I understand and I want to use mainnet.");
    expect(MAINNET_WARNING + MAINNET_CHECKBOX).not.toMatch(/—/);
  });
});
