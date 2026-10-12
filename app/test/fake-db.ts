// A tiny in-memory stand-in for the Supabase client: enough of select/insert/update/eq/in/gt for the server libs.
// `schema.missing` lists tables that do not exist yet (PostgREST PGRST205); `schema.columns` limits the
// columns an insert may use (an unknown one fails with PGRST204), to act out the database before a sql/ file runs.
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
export type FakeDb = { db: SupabaseClient; tables: Record<string, Row[]>; uniques: Record<string, string[]> };

export type FakeSchema = { missing?: string[]; columns?: Record<string, string[]> };

export function fakeDb(tables: Record<string, Row[]>, uniques: Record<string, string[]> = {}, schema: FakeSchema = {}): FakeDb {
  const from = (name: string) => {
    tables[name] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    let op: { kind: "select" } | { kind: "insert"; rows: Row[] } | { kind: "update"; patch: Row } = { kind: "select" };
    const run = () => {
      const t = tables[name]!;
      if (schema.missing?.includes(name)) {
        return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${name}' in the schema cache` } };
      }
      if (op.kind === "insert") {
        const cols = schema.columns?.[name];
        const unknown = cols && op.rows.flatMap((r) => Object.keys(r)).find((k) => !cols.includes(k));
        if (unknown) return { data: null, error: { code: "PGRST204", message: `Could not find the '${unknown}' column of '${name}' in the schema cache` } };
        const keys = uniques[name];
        for (const r of op.rows) {
          if (keys && t.some((x) => keys.every((k) => x[k] === r[k]))) return { data: null, error: { code: "23505" } };
        }
        t.push(...op.rows);
        return { data: op.rows, error: null };
      }
      const hit = t.filter((r) => filters.every((f) => f(r)));
      if (op.kind === "update") {
        for (const r of hit) Object.assign(r, op.patch);
        return { data: hit, error: null };
      }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const q = {
      select: () => q,
      order: () => q,
      range: () => q,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
      gt: (k: string, v: string) => (filters.push((r) => String(r[k]) > v), q),
      insert: (rows: Row | Row[]) => ((op = { kind: "insert", rows: Array.isArray(rows) ? rows : [rows] }), q),
      update: (patch: Row) => ((op = { kind: "update", patch }), q),
      maybeSingle: async () => {
        const r = run();
        return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
      },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, tables, uniques };
}
