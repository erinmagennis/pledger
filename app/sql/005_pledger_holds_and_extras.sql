-- Pledger: short holds while someone pays a person, and visible extra payments.
-- Paste into the Supabase SQL editor and run after 001 to 004. Additive and safe to run twice.
-- Until this runs, the app still works: nobody is held, and a payment that does not match what
-- is owed is turned away (and logged) as before, instead of being recorded as an extra.

-- Step 1: holds. A hold lasts 10 minutes and keeps a person out of "Help pay people back"
-- while one helper pays them, so two helpers do not pay the same person at once.
-- Server only: row level security on, no policies, so only the service key can read or write.
create table if not exists public.pledger_holds (
  id uuid primary key default gen_random_uuid(),
  payout_address text not null,
  created_at timestamptz default now(),
  expires_at timestamptz not null,
  source text not null check (source in ('pledger', 'outside'))
);

alter table public.pledger_holds enable row level security;

create index if not exists pledger_holds_address_expires_idx
  on public.pledger_holds (payout_address, expires_at);

-- The app clears holds that ended over a day ago before it adds new ones; this keeps that quick.
create index if not exists pledger_holds_expires_idx on public.pledger_holds (expires_at);

-- Step 2: extras. A real payment that passes the Base check but not the amount rule (too much,
-- too little, or to someone who owes nothing) is stored with kind = 'extra'. Extras never count
-- toward paid, owed, totals or public records. Every existing row becomes kind = 'paid'.
alter table public.pledger_payments
  add column if not exists kind text not null default 'paid' check (kind in ('paid', 'extra'));
