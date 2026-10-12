// Server-only live reads for pages: Tempo testnet pool and the Supabase line.
// Both fail soft: pages render honest zeros instead of erroring.
import type { LineEntry, PaymentRecord } from "./claims";
import { loadLineData } from "./claims-server";
import { getSupabase } from "./supabase";
import { readPool, type PoolData } from "./tempo";

export async function getLivePool(): Promise<PoolData | null> {
  try {
    return await readPool();
  } catch {
    return null;
  }
}

export type LineData = { connected: boolean; line: LineEntry[]; payments: PaymentRecord[] };

/** Empty line when the database is not connected or the read fails. */
export async function getLineData(): Promise<LineData> {
  const db = getSupabase();
  if (!db) return { connected: false, line: [], payments: [] };
  try {
    return { connected: true, ...(await loadLineData(db)) };
  } catch {
    return { connected: false, line: [], payments: [] };
  }
}
