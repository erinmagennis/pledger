-- Pledger: Artizen give-back claims, payments and public records.
-- Paste into the Supabase SQL editor and run. Safe to run twice: additive only, no DROP.
-- Every object is prefixed pledger_. RLS is on with no public policies; the app server
-- uses the service role key, so nothing here is readable with the anon key.
-- Privacy: no raw emails and no plain email addresses are stored. to_hash = sha256(lowercased address).

create extension if not exists pgcrypto;

create table if not exists public.pledger_claims (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  to_hash text not null,
  project text not null,
  purchased_at timestamptz not null,
  fee_cents integer not null,
  self_backed boolean not null default false,
  payout_address text not null,
  display_mode text not null default 'initials',
  display_name text,
  record_state text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint pledger_claims_fingerprint_key unique (fingerprint),
  constraint pledger_claims_fingerprint_hex check (fingerprint ~ '^[0-9a-f]{64}$'),
  constraint pledger_claims_to_hash_hex check (to_hash ~ '^[0-9a-f]{64}$'),
  constraint pledger_claims_fee_nonneg check (fee_cents >= 0),
  constraint pledger_claims_payout_hex check (payout_address ~ '^0x[0-9a-f]{40}$'),
  constraint pledger_claims_display_mode check (display_mode in ('full', 'initials', 'project')),
  constraint pledger_claims_display_name_len check (display_name is null or char_length(display_name) <= 60),
  constraint pledger_claims_record_state check (record_state in ('pending', 'recorded'))
);

create index if not exists pledger_claims_payout_idx on public.pledger_claims (payout_address);
create index if not exists pledger_claims_created_idx on public.pledger_claims (created_at);
create index if not exists pledger_claims_to_hash_idx on public.pledger_claims (to_hash);

create table if not exists public.pledger_payments (
  id uuid primary key default gen_random_uuid(),
  tx_hash text not null,
  to_address text not null,
  amount_units numeric(78, 0) not null,
  block_number bigint,
  block_time timestamptz not null,
  created_at timestamptz not null default now(),
  constraint pledger_payments_tx_hash_key unique (tx_hash),
  constraint pledger_payments_tx_hash_hex check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  constraint pledger_payments_to_hex check (to_address ~ '^0x[0-9a-f]{40}$'),
  constraint pledger_payments_amount_pos check (amount_units > 0)
);

create index if not exists pledger_payments_to_idx on public.pledger_payments (to_address);

create table if not exists public.pledger_attestations (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.pledger_claims (id),
  fingerprint text not null,
  status text not null,
  state text not null,
  uid text,
  tx_hash text,
  error text,
  created_at timestamptz not null default now(),
  constraint pledger_attestations_state check (state in ('pending', 'recorded'))
);

create index if not exists pledger_attestations_claim_idx on public.pledger_attestations (claim_id);
create index if not exists pledger_attestations_pending_idx on public.pledger_attestations (state) where state = 'pending';

alter table public.pledger_claims enable row level security;
alter table public.pledger_payments enable row level security;
alter table public.pledger_attestations enable row level security;
-- No policies on purpose: only the service role (server) can read or write.
