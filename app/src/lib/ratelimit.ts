// One shared in-memory per-IP limiter for the API routes. Counts live in this server instance only:
// they reset on restart and each serverless instance keeps its own. A speed bump against scripts, not a wall.
import { NextResponse } from "next/server";

export const TOO_MANY = "Too many requests. Try again in a few minutes.";
export const TEN_MIN = 10 * 60 * 1000;

const buckets = new Map<string, Map<string, number[]>>();

/** True when this IP may go ahead (and the request is counted); false when it already made `max` requests under `key` in the last `windowMs`. */
export function limit(key: string, ip: string, max: number, windowMs: number, now = Date.now()): boolean {
  const byIp = buckets.get(key) ?? new Map<string, number[]>();
  buckets.set(key, byIp);
  const hits = (byIp.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    byIp.set(ip, hits);
    return false;
  }
  hits.push(now);
  byIp.set(ip, hits);
  return true;
}

/** The caller's IP from the proxy headers, or "local". */
export function ipOf(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** The 429 answer routes send when `limit` says no. */
export const tooMany = () => NextResponse.json({ error: TOO_MANY }, { status: 429 });

/** For tests: forget all counts. */
export function resetLimits() {
  buckets.clear();
}
