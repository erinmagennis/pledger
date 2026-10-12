-- Pledger: limited Postgres role that can only touch the pledger_ tables. AFTER THE HACKATHON, not tonight: the app code must change first (docs/limited-role.md).
-- WHERE TO PASTE: Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
-- Safe to run twice: additive only, no DROP. Nothing here touches another app's objects.
-- Run after 001 to 006: the grants name pledger_faucet_log (006).
--
-- BEFORE YOU RUN: replace every <set-in-dashboard> below (find and replace all) with a strong password (12+ characters).
-- Prefer letters and digits only, so the connection string needs no percent-encoding.
-- The file stops with an error if the placeholder is left in. Or run with a throwaway value, then set
-- the real one in the dashboard:
--   Database > Roles > pledger_app > Change password.
--
-- AFTER YOU RUN, copy this into Vercel (Project > Settings > Environment Variables, Production):
--   PLEDGER_DATABASE_URL = postgresql://pledger_app.<PROJECT-REF>:<PASSWORD>@<POOLER-HOST>:6543/postgres?sslmode=require
-- Get <POOLER-HOST> and <PROJECT-REF> from the dashboard "Connect" dialog, shared pooler,
-- transaction mode (port 6543). The username must be pledger_app.<PROJECT-REF>, not just pledger_app.
-- Then see docs/limited-role.md: the server code change must ship before this variable is used.
--
-- Why a direct Postgres role: Supabase API keys (sb_secret_, sb_publishable_) can only map to the
-- built-in anon, authenticated and service_role roles, so a custom role cannot be reached through
-- supabase-js. The database connection string is the supported way to log in as a custom role.

-- The role is made without login first, so it can never sit open with the placeholder password.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pledger_app') then
    create role pledger_app with nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$$;

-- Stops the whole run if the placeholder below was not replaced.
do $$
begin
  if '<set-in-dashboard>' = ('<' || 'set-in-dashboard>') then
    raise exception 'Replace <set-in-dashboard> in this file with a real password, then run it again';
  end if;
end
$$;

alter role pledger_app with login password '<set-in-dashboard>';

-- Schema access only. No create on schema, so the role cannot make or alter objects.
grant usage on schema public to pledger_app;

-- Tables Pledger uses (001, 005, 006). Add a table here if a later file adds a pledger_ table.
-- No delete, except pledger_holds: claims-server.ts prunes expired holds with a delete.
grant select, insert, update on table
  public.pledger_claims,
  public.pledger_payments,
  public.pledger_attestations,
  public.pledger_holds,
  public.pledger_faucet_log
to pledger_app;
grant delete on table public.pledger_holds to pledger_app;

-- Sequences: pledger_faucet_log.id (006, bigserial) needs one; this grants every pledger_ sequence.
do $$
declare s record;
begin
  for s in select sequence_schema, sequence_name from information_schema.sequences
           where sequence_schema = 'public' and sequence_name like 'pledger\_%' loop
    execute format('grant usage, select on sequence %I.%I to pledger_app', s.sequence_schema, s.sequence_name);
  end loop;
end
$$;

-- Keep the pledger_ tables closed to everyone except this role and the existing service_role path.
-- Scoped to pledger_ tables only: a blanket revoke on schema public could break other apps.
revoke all on table
  public.pledger_claims,
  public.pledger_payments,
  public.pledger_attestations,
  public.pledger_holds,
  public.pledger_faucet_log
from public;
-- The revoke above only removes PUBLIC grants. Re-assert this role's grants after it.
grant select, insert, update on table
  public.pledger_claims,
  public.pledger_payments,
  public.pledger_attestations,
  public.pledger_holds,
  public.pledger_faucet_log
to pledger_app;
grant delete on table public.pledger_holds to pledger_app;

-- RLS is on for every pledger_ table with no policies (001, 005, 006), and pledger_app does not bypass RLS,
-- so it needs policies. They name this role only: anon and authenticated still see nothing.
do $$
declare
  t text;
  op text;
begin
  foreach t in array array['pledger_claims','pledger_payments','pledger_attestations','pledger_holds','pledger_faucet_log'] loop
    foreach op in array array['select','insert','update'] loop
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_app_' || op) then
        if op = 'select' then
          execute format('create policy %I on public.%I for select to pledger_app using (true)', t || '_app_' || op, t);
        elsif op = 'insert' then
          execute format('create policy %I on public.%I for insert to pledger_app with check (true)', t || '_app_' || op, t);
        else
          execute format('create policy %I on public.%I for update to pledger_app using (true) with check (true)', t || '_app_' || op, t);
        end if;
      end if;
    end loop;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pledger_holds' and policyname = 'pledger_holds_app_delete') then
    create policy pledger_holds_app_delete on public.pledger_holds for delete to pledger_app using (true);
  end if;
end
$$;

-- Check (run after, one block at a time). The last query must fail with "permission denied".
--   set role pledger_app;
--   select count(*) from public.pledger_claims;
--   select * from public.<some_other_app_table> limit 1;
--   reset role;
