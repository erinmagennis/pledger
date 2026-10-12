import type { Result } from './index.js';

export const PAIR_WINDOW_MS = 24 * 60 * 60 * 1000;

export type PairedReceipt = Result & { selfBacked: boolean; pairedSoldFingerprint?: string };

export interface PairResult {
  /** Receipts annotated with selfBacked. Only receipts carry money. */
  receipts: PairedReceipt[];
  /** Sold emails that matched no receipt. Informational only; never add money. */
  unpairedSolds: Result[];
}

const normProject = (p?: string) => (p ?? '').toLowerCase().replace(/\s+/g, '');

/**
 * Mark a receipt self-backed when a sold email has the same inbox (`to`), same project
 * (case/whitespace-insensitive), the same contribution amount, and a date within 24h.
 * Each sold email pairs with at most one receipt (closest in time wins).
 * Only ok receipts / ok solds are considered.
 */
export function pairSelfBacked(receipts: Result[], solds: Result[]): PairResult {
  const pool = solds.filter((s) => s.ok && s.kind === 'sold');
  const used = new Set<number>();
  const out: PairedReceipt[] = receipts.map((r) => {
    if (!r.ok || r.kind !== 'receipt' || !r.to || !r.date || r.contribution === undefined) {
      return { ...r, selfBacked: false };
    }
    const rt = Date.parse(r.date);
    let best = -1;
    let bestDelta = Infinity;
    pool.forEach((s, i) => {
      if (used.has(i) || !s.to || !s.date || s.contribution === undefined) return;
      if (s.to.toLowerCase() !== r.to!.toLowerCase()) return;
      if (normProject(s.project) !== normProject(r.project)) return;
      if (Math.round(s.contribution * 100) !== Math.round(r.contribution! * 100)) return;
      const delta = Math.abs(Date.parse(s.date) - rt);
      if (!(delta <= PAIR_WINDOW_MS)) return;
      if (delta < bestDelta) {
        best = i;
        bestDelta = delta;
      }
    });
    if (best < 0) return { ...r, selfBacked: false };
    used.add(best);
    return { ...r, selfBacked: true, pairedSoldFingerprint: pool[best].fingerprint };
  });
  return { receipts: out, unpairedSolds: pool.filter((_, i) => !used.has(i)) };
}
