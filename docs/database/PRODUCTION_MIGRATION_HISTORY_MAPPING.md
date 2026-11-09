# Production Migration History Mapping

## Purpose

This document records the relationship between three Supabase migration-history
versions generated during production application and their canonical migration
files in this repository.

The generated history versions are intentionally retained. They represent the
same intended migration operations as the repository files, but use different
version timestamps and history labels.

**Do not reapply these migrations solely to align their names or timestamps.**
Do not manually edit Supabase's internal migration-history table.

## Mapping

| Production history version | Production history name | Canonical repository migration | Repository file SHA |
|---|---|---|---|
| `20261107184510` | `gms_bulk_assignment_pending_request_guard` | `20261116000000_gms_bulk_assignment_pending_request_guard.sql` | `2dd0dca0ec3bb5a27c265387a0756d48fefcb505` |
| `20261107184551` | `gms_atomic_weekend_schedule_replace` | `20261117000000_gms_atomic_weekend_schedule_replace.sql` | `2986ee6b34d77011f9df0477ceca2ea464408195` |
| `20261107184607` | `gms_anonymous_public_privilege_hardening` | `20261118000000_gms_anonymous_public_privilege_hardening.sql` | `ecc3d36eae1a763ffe7bc0942ddafa7d680198bf` |

The SHA values above are the Git blob SHAs of the canonical repository files
on `security/push-endpoint-hardening` when this mapping was recorded.

## Application and verification notes

- The three production SQL operations were applied through the Supabase
  integration under the generated history versions shown above.
- The SQL supplied for those operations was sourced from the corresponding
  canonical repository migration files.
- Post-application checks confirmed:
  - `admin_bulk_assignments_grouped` contains the pending-request protections
    and the expected authenticated/service-role execution grants.
  - `admin_replace_generated_weekend_schedules(jsonb)` exists with the
    expected transactional replacement implementation and execution grants.
  - Anonymous privileges on public tables and sequences are revoked, and
    postgres-role default table/sequence privileges no longer grant access to
    `anon`.
  - The intended read policies on availability, schedules, and assignments
    remain in place.
- These checks verify the reported database effects. They are not a byte-for-byte
  export comparison of the historical SQL payload stored by Supabase.
- The canonical migration files remain the source-controlled reference for
  future development and review.

## Future migration handling

1. Keep the generated production history versions as the recorded applied
   versions unless a separately reviewed migration-history normalization is
   explicitly approved.
2. Do not run these three migrations again against production just because the
   repository filenames differ from the production history labels.
3. Before future production migrations, inspect both local migration files and
   linked remote migration history.
4. If a future migration depends on one of these changes, reference the canonical
   repository filename and this mapping in its review notes.
5. Never use direct SQL writes to Supabase's internal migration-history table.
6. Keep staging and production differences documented; do not blindly copy
   environment-specific cron jobs, functions, policies, or privileges.

## Scope and safety

This document is repository documentation only. It does not execute SQL,
change Supabase configuration, modify secrets, alter application behavior, or
authorize a Preview or Production deployment.
