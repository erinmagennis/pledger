-- Pledger: let one transaction pay several people in line (batch payouts).
-- Paste into the Supabase SQL editor and run after 001 and 002. Safe to run twice.
-- Until this runs, the app still records single-person payments. A batch payment to a
-- second person shows "Batch payments need the 003 update".

-- Step 1 (additive): a payment is unique per transaction AND recipient.
create unique index if not exists pledger_payments_tx_to_key
  on public.pledger_payments (tx_hash, to_address);

-- Step 2 (the one non-additive line, Erin approves and runs it herself):
-- This removes only the old rule "one row per transaction". It deletes no rows and changes
-- no data. After it, the same transaction can be recorded once for each person it paid.
-- Step 1 above still blocks recording the same person twice for one transaction.
alter table public.pledger_payments drop constraint if exists pledger_payments_tx_hash_key;
