-- Pledger: self-serve match pledges on Tempo testnet (the form at /make).
-- Paste into the Supabase SQL editor and run after 001 to 007. Additive and safe to run twice.
-- Until this runs, the app still works: /make shows the form, and creating answers
-- "Making test pledges is not switched on yet". Existing pages are not affected.

-- One row per pledge made from /make. The pool itself lives on Tempo testnet; this row is how
-- /pledges/p/<slug> finds it, and how the daily caps are counted (3 per visitor, 40 overall).
-- ip_hash is an HMAC-SHA256 of the caller's IP with PLEDGER_PEPPER (plain sha256 if unset), never the IP itself.
-- Server only: row level security on, no policies, so only the service key can read or write.
create table if not exists public.pledger_selfserve_pledges (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  slug text not null unique,
  pool_address text not null unique,
  name text not null,
  pool_usd numeric(12, 2) not null check (pool_usd > 0 and pool_usd <= 500),
  match_bps integer not null check (match_bps > 0),
  cap_usd numeric(12, 2) not null check (cap_usd > 0),
  lock_until timestamptz not null,
  recipient text not null,
  recipient_is_demo boolean not null default true,
  sponsor text not null,
  deploy_tx text not null,
  deposit_tx text not null,
  deploy_block bigint not null,
  ip_hash text not null
);

alter table public.pledger_selfserve_pledges enable row level security;

create index if not exists pledger_selfserve_pledges_created_idx on public.pledger_selfserve_pledges (created_at);
create index if not exists pledger_selfserve_pledges_ip_idx on public.pledger_selfserve_pledges (ip_hash, created_at);

-- If the limited role from 007 exists, let it read and add rows here too (no update or delete needed).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'pledger_app') then
    grant select, insert on table public.pledger_selfserve_pledges to pledger_app;
    grant usage, select on sequence public.pledger_selfserve_pledges_id_seq to pledger_app;
  end if;
end
$$;

-- Tell the Supabase API to pick up the new table now, not on its next schema refresh.
notify pgrst, 'reload schema';
