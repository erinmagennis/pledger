"use client";

// The network choice: testnet (test money, the default) or mainnet (real money, after consent).
// Stored per browser in localStorage. The server always renders testnet; the client switches after mount.
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Net = "testnet" | "mainnet";

export const NET_KEY = "pledger.net";
export const CONSENT_KEY = "pledger.net.consent";
export const DEFAULT_NET: Net = "testnet";

/** The parts of Storage this file uses, so tests can pass a plain object. */
export type NetStorage = Pick<Storage, "getItem" | "setItem">;

/** Anything other than the exact string "mainnet" is testnet. */
export function parseNet(v: unknown): Net {
  return v === "mainnet" ? "mainnet" : DEFAULT_NET;
}

export function hasConsent(v: unknown): boolean {
  return v === "1";
}

/** Mainnet only when it was chosen and consent was given in this browser. */
export function resolveNet(stored: unknown, consent: unknown): Net {
  return parseNet(stored) === "mainnet" && hasConsent(consent) ? "mainnet" : DEFAULT_NET;
}

/** True when switching to `target` must show the consent panel first. */
export function needsConsent(target: Net, consent: unknown): boolean {
  return target === "mainnet" && !hasConsent(consent);
}

function browserStorage(): NetStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(key: string, s: NetStorage | null): string | null {
  try {
    return s ? s.getItem(key) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: string, s: NetStorage | null): void {
  try {
    s?.setItem(key, value);
  } catch {
    /* private mode or blocked storage: the choice lasts for this page only */
  }
}

export function readNet(s: NetStorage | null = browserStorage()): Net {
  return resolveNet(read(NET_KEY, s), read(CONSENT_KEY, s));
}

export function readConsent(s: NetStorage | null = browserStorage()): boolean {
  return hasConsent(read(CONSENT_KEY, s));
}

export function writeNet(net: Net, s: NetStorage | null = browserStorage()): void {
  write(NET_KEY, net, s);
}

export function writeConsent(s: NetStorage | null = browserStorage()): void {
  write(CONSENT_KEY, "1", s);
}

type NetContext = {
  net: Net;
  /** Consent was given in this browser (or this page, when storage is blocked). */
  consented: boolean;
  /** Switch to testnet, or to mainnet when consent is already given. Returns false when consent is needed. */
  setNet: (net: Net) => boolean;
  /** Record consent and switch to mainnet. */
  acceptMainnet: () => void;
};

const Ctx = createContext<NetContext>({ net: DEFAULT_NET, consented: false, setNet: () => false, acceptMainnet: () => {} });

export function NetProvider({ children }: { children: ReactNode }) {
  const [net, setNetState] = useState<Net>(DEFAULT_NET);
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    setNetState(readNet());
    setConsented(readConsent());
    // Keep other tabs in step.
    const onStorage = (e: StorageEvent) => {
      if (e.key === NET_KEY || e.key === CONSENT_KEY) {
        setNetState(readNet());
        setConsented(readConsent());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setNet = useCallback(
    (next: Net) => {
      if (next === "mainnet" && !consented) return false;
      setNetState(next);
      writeNet(next);
      return true;
    },
    [consented],
  );

  const acceptMainnet = useCallback(() => {
    writeConsent();
    writeNet("mainnet");
    setConsented(true);
    setNetState("mainnet");
  }, []);

  const value = useMemo(() => ({ net, consented, setNet, acceptMainnet }), [net, consented, setNet, acceptMainnet]);
  return createElement(Ctx.Provider, { value }, children);
}

export function useNet(): NetContext {
  return useContext(Ctx);
}
