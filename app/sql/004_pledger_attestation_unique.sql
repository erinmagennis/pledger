-- Pledger: one public record per claim and status, so a person is never attested as paid twice.
-- Paste into the Supabase SQL editor and run after 001 to 003. Additive and safe to run twice.
-- ORDER: run this BEFORE 005, and before PLEDGER_ATTESTER_KEY and PLEDGER_EAS_SCHEMA_UID are set, so no
-- public record is sent while two racing requests could both claim the same (claim, status) slot.
-- Check first: the query below must return no rows. If it returns any, stop and ask; the old code
-- could have written the same (claim, status) twice and the index will not build over duplicates.
--   select claim_id, status, count(*) from public.pledger_attestations group by 1, 2 having count(*) > 1;

create unique index if not exists pledger_attestations_claim_status_key
  on public.pledger_attestations (claim_id, status);

-- Tell the Supabase API to pick up the change now, not on its next schema refresh.
notify pgrst, 'reload schema';
