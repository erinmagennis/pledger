"use client";

// The holds this browser made (pid -> expiry, ms), so the page never shows "Someone is paying this person now"
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
  const ids = [...new Set(pids)].filter(Boolean).slice(0, 50);
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
