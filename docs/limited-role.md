# Limited Postgres role for pledger_ tables

Status: drafted, not applied. Backlog item 2 in `notes/2026-10-12-backlog.md`.

## Problem

`src/lib/supabase.ts` builds a supabase-js client with the project secret key. That key maps to the built-in `service_role` role, which bypasses RLS and reaches every app's tables in the shared project.

## Options checked against current Supabase docs

- (b) Custom API key scoped to a custom role: not supported. The API keys page says every key resolves to a built-in role (`anon`, `authenticated`, `service_role`). Secret and publishable keys are not JWTs, so a JWT role claim does not apply to them.
- (c) RLS keyed on a custom JWT claim with the publishable key: does not isolate the key. The publishable key still maps to `anon`, and Pledger would need to mint signed JWTs, which means holding a project-wide signing secret. Not simpler. (This reading is an inference from the docs, not a documented walkthrough.)
- (a) Custom Postgres role over a direct connection string: supported. The roles page documents `create role ... with login password` and recommends one role per service. The connecting page documents the custom role username `[ROLE].[PROJECT-REF]` through the shared pooler. Chosen. A leaked credential reaches only the five pledger_ tables (claims, payments, attestations, holds, faucet_log). The table from sql/006 needs grants too.

Sources:
- https://supabase.com/docs/guides/database/postgres/roles
- https://supabase.com/docs/guides/api/api-keys
- https://supabase.com/docs/guides/database/connecting-to-postgres

## Steps

1. Erin: edit the password placeholder in `sql/007_pledger_limited_role.sql`, paste into the SQL editor, run, then run the check queries at the bottom.
2. Erin: add `PLEDGER_DATABASE_URL` in Vercel (shared pooler, transaction mode, port 6543, user `pledger_app.<PROJECT-REF>`). Add the name to `.env.example`.
3. Code change (below), deploy, confirm all routes return 200.
4. Last: remove `SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from Vercel and rotate the secret key, so the broad key no longer sits in Pledger's environment.

## Code change

- Library: `postgres` (postgres.js). It has a first-class `prepare: false` option for the transaction pooler, is small, and has no native build on Vercel. `pg` also works but needs more pool setup.
- Env var: `PLEDGER_DATABASE_URL`.
- Replace `src/lib/supabase.ts` with a `src/lib/db.ts` that creates one client at module scope: `postgres(url, { max: 1, prepare: false, ssl: "require" })`. Keep `import "server-only"` and return null when the variable is missing, so the `DB_MISSING` behavior is unchanged.
- supabase-js is a query builder over HTTP, so moving off it means rewriting each query as SQL. Today: 12 `getSupabase()` call sites across 5 files (`src/lib/claims-server.ts`, `src/lib/payments-server.ts`, `src/lib/eas.ts`, `src/app/api/claims/submit/route.ts`, `src/app/api/demo/fund/route.ts`), about 40 builder calls (select, insert, update, eq, in, order, limit, maybeSingle, and one delete on `pledger_holds` at `claims-server.ts:197`).
- Error handling changes. supabase-js returns `{ data, error }` with PostgREST codes (`PGRST204`, `PGRST205`). postgres.js throws, with Postgres codes: `23505` stays, and `42P01` and `42703` replace the PGRST ones. `isMissingSchema` and the `23505` checks in `claims/submit/route.ts` and `eas.ts` need a try/catch form.
- Types: `timestamptz` columns come back as `Date`, not string. Check places that compare or serialize dates.
- Tests in `test/` that mock supabase-js need a mock of the new module.

## Size estimate

Medium, about a half day to a full day: 5 files, about 40 queries, plus test updates. Most of the risk sits in two error-code branches, the attestation slot claim in `eas.ts` and the duplicate claim in `submit`. They prevent a double on-chain attestation and a double claim. Do those two first and test them against a real database.

## Done when

With the new connection string, a query on a non-pledger table fails with permission denied and every Pledger route returns 200 on the live site.

## Risk to flag

The transaction pooler gives no session state and no prepared statements, so keep `prepare: false`. `max: 1` per serverless instance is fine at hackathon traffic; revisit if a route runs concurrent queries.
