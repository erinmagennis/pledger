// A tiny in-memory stand-in for the Supabase client: enough of select/insert/update/delete/eq/is/in/gt/lt/order/
// range/limit for the server libs. `schema.missing` lists tables that do not exist yet (PostgREST PGRST205);
// `schema.columns` limits the columns an insert may use (an unknown one fails with PGRST204) and a filter may
// use (Postgres 42703), to act out the database before a sql/ file runs. Column defaults (sql/005's
// pledger_payments.kind = 'paid') apply to rows that leave the column out, when the column exists.
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
export type FakeDb = { db: SupabaseClient; tables: Record<string, Row[]>; uniques: Record<string, string[]> };

/** `insertError` makes every insert into that table fail with the given error (an outage, say). */
export type FakeSchema = { missing?: string[]; columns?: Record<string, string[]>; insertError?: Record<string, { code: string; message?: string }> };

const DEFAULTS: Record<string, Row> = { pledger_payments: { kind: "paid" } };

export function fakeDb(tables: Record<string, Row[]>, uniques: Record<string, string[]> = {}, schema: FakeSchema = {}): FakeDb {
  const from = (name: string) => {
    tables[name] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    const filterCols: string[] = [];
    let sort: { col: string; asc: boolean } | null = null;
    let slice: [number, number] | null = null;
    let op: { kind: "select" } | { kind: "insert"; rows: Row[] } | { kind: "update"; patch: Row } | { kind: "delete" } = { kind: "select" };
    const has = (k: string) => !schema.columns?.[name] || schema.columns[name]!.includes(k);
    const val = (r: Row, k: string) => r[k] ?? (has(k) ? DEFAULTS[name]?.[k] : undefined);
    const where = (k: string, f: (v: unknown) => boolean) => (filterCols.push(k), filters.push((r) => f(val(r, k))), q);
    const run = () => {
      const t = tables[name]!;
      if (schema.missing?.includes(name)) {
        return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${name}' in the schema cache` } };
      }
      const badCol = filterCols.find((k) => !has(k));
      if (badCol) return { data: null, error: { code: "42703", message: `column ${name}.${badCol} does not exist` } };
      if (op.kind === "insert") {
        const failed = schema.insertError?.[name];
        if (failed) return { data: null, error: failed };
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
      if (op.kind === "delete") {
        tables[name] = t.filter((r) => !hit.includes(r));
        return { data: hit, error: null };
      }
      if (sort) {
        const { col, asc } = sort;
        hit.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      const out = slice ? hit.slice(slice[0], slice[1]) : hit;
      return { data: out.map((r) => ({ ...r })), error: null };
    };
    const q = {
      select: () => q,
      order: (col: string, o: { ascending?: boolean } = {}) => ((sort = { col, asc: o.ascending !== false }), q),
      range: (from: number, to: number) => ((slice = [from, to + 1]), q),
      limit: (n: number) => ((slice = [0, n]), q),
      eq: (k: string, v: unknown) => where(k, (x) => x === v),
      is: (k: string, v: null) => where(k, (x) => (x ?? null) === v),
      in: (k: string, vs: unknown[]) => where(k, (x) => vs.includes(x)),
      gt: (k: string, v: string) => where(k, (x) => String(x) > v),
      lt: (k: string, v: string) => where(k, (x) => String(x) < v),
      insert: (rows: Row | Row[]) => ((op = { kind: "insert", rows: Array.isArray(rows) ? rows : [rows] }), q),
      update: (patch: Row) => ((op = { kind: "update", patch }), q),
      delete: () => ((op = { kind: "delete" }), q),
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
