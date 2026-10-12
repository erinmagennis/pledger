-- Pledger: a shared hourly cap on the demo faucet.
-- Paste into the Supabase SQL editor and run after 001 to 005. Additive and safe to run twice.
-- Until this runs, the app still works: the demo faucet keeps only its per-IP limit, which lives in
-- server memory and resets on restart.

-- One row per wallet the demo funded. The app counts the last hour and turns people away at 40.
-- ip_hash is a sha256 of the caller's IP, never the IP itself.
-- Server only: row level security on, no policies, so only the service key can read or write.
create table if not exists public.pledger_faucet_log (
  id bigserial primary key,
  created_at timestamptz default now(),
  ip_hash text not null,
  address text not null
);

alter table public.pledger_faucet_log enable row level security;

create index if not exists pledger_faucet_log_created_idx on public.pledger_faucet_log (created_at);
