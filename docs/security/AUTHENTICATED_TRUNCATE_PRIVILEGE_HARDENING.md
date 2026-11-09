# Authenticated TRUNCATE privilege hardening

## Verified finding

A live ACL inspection on 2026-11-09 found 15 of 18 Production `public` tables where `authenticated` had an effective `TRUNCATE` grant. All inspected application tables were owned by `postgres`. Staging already had no effective `TRUNCATE` grants on its current public tables.

The Production `postgres` default ACL for `public` also granted `TRUNCATE` to `authenticated`. Staging's `postgres` default ACL had already been corrected by the operation recorded in its ledger as `20261109112851`.

## Change applied

The migration performs only:

1. Revoke `TRUNCATE` from `authenticated` on all current tables in `public`.
2. Revoke `TRUNCATE` from the default privileges used by the `postgres` role when creating future tables in `public`.

It does not change SELECT, INSERT, UPDATE, DELETE, sequence privileges, function execution, RLS policies, cron jobs, secrets, Edge Functions or application data. The regression checks that authenticated application DML and notification reads remain available, and that `service_role` retains its existing `TRUNCATE` privilege on core schedule tables.

## Production application and verification

The separately approved Production migration was applied successfully on 2026-11-09 through the Supabase migration operation. Its Production ledger entry is:

- Production: `20261109165402` — `revoke_authenticated_public_truncate`
- Staging: `20261109112851` — `revoke_authenticated_public_truncate`

The checked-in migration filename retains Staging's pre-existing version so the source file represents the operation already recorded there. Production's migration operation generated a different ledger version. These entries represent the same idempotent SQL, but the version mismatch must remain visible in the migration-ledger crosswalk. Do not manually edit Supabase's internal migration ledger or run a broad `supabase db push` until historical Production/Staging migration mappings are reconciled.

Post-application verification on both projects:

| Check | Production | Staging |
|---|---:|---:|
| Current public tables with effective authenticated TRUNCATE | 0 / 18 | 0 / 18 |
| postgres public table defaults grant authenticated TRUNCATE | No | No |
| RLS disabled on public tables | 0 | 0 |

Production and Staging both retain authenticated SELECT, INSERT, UPDATE and DELETE on the core `schedules` and `assignments` tables. `service_role` retains TRUNCATE on those tables.

## Supabase-managed default privilege limitation

Both projects also have a separate `supabase_admin` default ACL in `public` that includes `TRUNCATE` for `authenticated` (and `anon`). Supabase documents that this platform-managed default belongs to `supabase_admin` and cannot be changed by the ordinary project SQL role. This migration deliberately does not claim to alter it.

The GMS application migration path creates application-owned tables as `postgres`; the regression creates a rollback-only probe table as `postgres` to verify that this future-table path is hardened. If Supabase later creates a public table as `supabase_admin`, its platform default ACL remains a separate platform-level concern.

References:
- [Supabase KB: default privileges for supabase_admin](https://supabase.com/kb/troubleshooting/cant-change-the-default-privileges-of-supabase_admin-in-the-public-schema-448af9)
- [PostgreSQL: ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html)

## CI and deployment boundaries

The targeted GitHub Actions SQL job applies the idempotent migration and runs the rollback-only regression against Staging. The regression checks all current public tables, a newly created postgres-owned probe, postgres default ACLs, application DML, RLS and the backend worker grant.

No Vercel Preview or Production deployment is part of this PR. The Production database migration was a separate, explicitly approved operation. No Edge Function, secret, cron job or application data change was made.
