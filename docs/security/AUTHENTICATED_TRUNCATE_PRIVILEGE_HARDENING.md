# Authenticated TRUNCATE privilege hardening

## Verified finding

A live ACL inspection on 2026-11-09 found 15 Production-owned public tables where `authenticated` had a direct `TRUNCATE` grant. All inspected application tables are owned by `postgres`. The same effective grant was absent on current Staging tables.

The Production `postgres` default ACL for `public` also grants `TRUNCATE` to `authenticated`. Staging's `postgres` default ACL has already been corrected by the operation recorded in its ledger as `20261109112851`.

The migration in this branch uses that existing Staging migration version as its filename so source control can represent the already-applied Staging operation and apply the same idempotent operation to Production through a separately approved route.

## Change

The migration performs only:

1. Revoke `TRUNCATE` from `authenticated` on all current tables in `public`.
2. Revoke `TRUNCATE` from the default privileges used by the `postgres` role when creating future tables in `public`.

It does not change SELECT, INSERT, UPDATE, DELETE, sequence privileges, function execution, RLS policies, cron jobs, secrets, Edge Functions or data. The regression checks that authenticated application DML and notification reads remain available, and that `service_role` retains its existing `TRUNCATE` privilege on core schedule tables.

## Supabase-managed default privilege limitation

Both projects also have a separate `supabase_admin` default ACL in `public` that includes `TRUNCATE` for `authenticated` (and `anon`). Supabase documents that this platform-managed default belongs to `supabase_admin` and cannot be changed by the ordinary project SQL role. This migration deliberately does not claim to alter it.

The GMS application migration path creates application-owned tables as `postgres`; the regression creates a rollback-only probe table as `postgres` to verify that this future-table path is hardened. If Supabase later creates a public table as `supabase_admin`, its platform default ACL remains a separate platform-level concern.

References:
- [Supabase KB: default privileges for supabase_admin](https://supabase.com/kb/troubleshooting/cant-change-the-default-privileges-of-supabase_admin-in-the-public-schema-448af9)
- [PostgreSQL: ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html)

## Validation plan

The targeted GitHub Actions Staging SQL job applies the idempotent migration to Staging and runs the rollback-only regression. The regression checks all current public tables, a newly created postgres-owned probe, postgres default ACLs, application DML, RLS and the backend worker grant.

Production remains unchanged until its migration is separately approved and applied. Do not use a broad `supabase db push` to promote this change while the repository's historical Production/Staging migration ledgers remain unreconciled.

## Current status

- Staging current tables: no effective authenticated TRUNCATE grant.
- Staging postgres-owned public table defaults: no authenticated TRUNCATE grant.
- Production current tables: 15 authenticated TRUNCATE grants remain.
- Production postgres-owned public table defaults: authenticated TRUNCATE remains.
- Production migration: not applied by this branch.
