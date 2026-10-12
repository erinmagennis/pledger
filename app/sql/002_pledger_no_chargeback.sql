-- Pledger: store the claimant's "no chargeback" confirmation with each claim.
-- Paste into the Supabase SQL editor and run after 001. Additive only, safe to run twice.
-- The value is part of the signed claim message; the app only stores claims where it is true.

alter table public.pledger_claims
  add column if not exists no_chargeback boolean not null default false;

alter table public.pledger_claims
  add column if not exists not_restricted_region boolean not null default false;
