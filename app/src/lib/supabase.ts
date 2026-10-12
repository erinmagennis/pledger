// Server-only Supabase client (service role). Never import from client components.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

/** Returns null when SUPABASE_URL or the secret key is not set. Prefers the new sb_secret_ key (SUPABASE_SECRET_KEY); the legacy service_role JWT still works until Supabase retires it (end of 2026). */
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof window !== "undefined" || !url || !key) {
    cached = null;
    return cached;
  }
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

export const DB_MISSING = { error: "Database not connected yet" } as const;
