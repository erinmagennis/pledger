-- Pledger: one public record per claim and status, so a person is never attested as paid twice.
-- Paste into the Supabase SQL editor and run after 001 to 003. Additive and safe to run twice.
-- Check first: the query below must return no rows. If it returns any, stop and ask; the old code
-- could have written the same (claim, status) twice and the index will not build over duplicates.
--   select claim_id, status, count(*) from public.pledger_attestations group by 1, 2 having count(*) > 1;

create unique index if not exists pledger_attestations_claim_status_key
  on public.pledger_attestations (claim_id, status);
