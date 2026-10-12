"use client";

// What this browser keeps: its holds, and the payments it sent that are not recorded yet (further down).
// Holds (pid -> expiry, ms) are kept so the page never shows "Someone is paying this person now"
// for the helper's own hold, and their own preview hold does not hide people from their own split.
// Holds are a courtesy: a failed hold never stops anyone paying.
import { useSyncExternalStore } from "react";
import type { HoldSource } from "@/lib/claims";

const mine = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

export type HoldAnswer = { held: boolean; until?: string };

/** Hold people for 10 minutes (or refresh their hold). Never throws. held: false before sql/005 or on any error. */
export async function hold(pids: string[], source: HoldSource): Promise<HoldAnswer> {
  // The server holds up to 10 people per request (and per IP); a bigger split holds its first 10.
  const ids = [...new Set(pids)].filter(Boolean).slice(0, 10);
  if (!ids.length) return { held: false };
  try {
    const res = await fetch("/api/line/hold", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pids: ids, source }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.held || typeof j.until !== "string") return { held: false };
    const until = Date.parse(j.until);
    for (const p of Array.isArray(j.pids) ? (j.pids as string[]) : ids) mine.set(p, until);
    version++;
    listeners.forEach((l) => l());
    return { held: true, until: j.until };
  } catch {
    return { held: false };
  }
}

/** True while this browser holds the person. */
export const isMine = (pid: string) => (mine.get(pid) ?? 0) > Date.now();

/** pids this browser holds right now (sent to the split so the helper's own hold does not hide them). */
export const myHeldPids = () => [...mine].filter(([, until]) => until > Date.now()).map(([pid]) => pid);

/** Re-render when this browser makes or refreshes a hold. */
export function useMyHolds(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => version,
    () => 0,
  );
}

// ---------- Payments this browser sent ----------
// A sent tx is kept here from the moment the wallet returns its hash until the server records it (or the rule
// turns it away for good), so a closed tab or a lost answer does not lose it: the page checks it again on load.
// Storage can be missing or throw (private mode, blocked site data), so every read and write is wrapped.

export const SENT_KEY = "pledger.sent";
/** Older than this, a sent tx is dropped unread: the hold is long gone and the link can still be pasted by hand. */
export const SENT_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const SENT_MAX = 100;

/** One person's share of a sent tx. `txs` holds the hashes to check, best match first (one batch can have several).
 * `from` says which part of the page sent it, so only that part checks it again. */
export type SentTx = { from: "help" | "pay"; pid: string; address: string; amountUnits: string; txs: string[]; label?: string; at: number };

export const sentId = (s: Pick<SentTx, "address" | "txs">) => `${s.address.toLowerCase()}:${(s.txs[0] ?? "").toLowerCase()}`;

const isSent = (x: unknown): x is SentTx => {
  const s = x as SentTx;
  return (
    !!s &&
    (s.from === "help" || s.from === "pay") &&
    typeof s.pid === "string" &&
    typeof s.address === "string" &&
    typeof s.amountUnits === "string" &&
    Array.isArray(s.txs) &&
    s.txs.length > 0 &&
    s.txs.every((t) => typeof t === "string") &&
    typeof s.at === "number" &&
    (s.label === undefined || typeof s.label === "string")
  );
};

/** Read the stored list. Anything malformed or older than SENT_MAX_AGE is left out. */
export function parseSent(raw: string | null, now = Date.now()): SentTx[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter(isSent).filter((s) => now - s.at < SENT_MAX_AGE) : [];
  } catch {
    return [];
  }
}

export const serializeSent = (list: SentTx[]) => JSON.stringify(list);

/** Add sent txs, replacing any with the same person and first hash. Keeps the newest SENT_MAX. */
export function addSent(list: SentTx[], items: SentTx[]): SentTx[] {
  const ids = new Set(items.map(sentId));
  return [...list.filter((s) => !ids.has(sentId(s))), ...items].slice(-SENT_MAX);
}

/** Drop the given ids (recorded, or turned away for good) and anything too old. */
export function pruneSent(list: SentTx[], doneIds: string[], now = Date.now()): SentTx[] {
  const done = new Set(doneIds);
  return list.filter((s) => !done.has(sentId(s)) && now - s.at < SENT_MAX_AGE);
}

function readSent(): SentTx[] {
  try {
    return parseSent(window.localStorage.getItem(SENT_KEY));
  } catch {
    return [];
  }
}

function writeSent(list: SentTx[]) {
  try {
    if (list.length) window.localStorage.setItem(SENT_KEY, serializeSent(list));
    else window.localStorage.removeItem(SENT_KEY);
  } catch {
    // storage blocked: the in-page "Check again" still works for this visit
  }
}

/** Sent txs from this part of the page that are not recorded yet. */
export const loadSent = (from: SentTx["from"]) => readSent().filter((s) => s.from === from);

export const rememberSent = (items: SentTx[]) => {
  if (items.length) writeSent(addSent(readSent(), items));
};

export const forgetSent = (ids: string[]) => {
  if (ids.length) writeSent(pruneSent(readSent(), ids));
};

/** A failed record worth checking again later: not on Base yet, the server had trouble, too many requests (429),
 * or a 409 (already recorded is handled as done before this; the 003 answer clears once sql/003 runs).
 * Anything else is the rule saying no, for good. */
export const worthRetrying = (status: number, error: string) => status >= 500 || status === 429 || status === 409 || /not found/i.test(error);
