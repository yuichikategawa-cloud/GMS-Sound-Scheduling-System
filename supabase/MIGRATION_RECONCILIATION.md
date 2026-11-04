# Staging database migration reconciliation

## Scope
This branch is a migration-source repair only. It does not apply SQL to either Supabase project, deploy Edge Functions, configure Vercel, rotate secrets, or alter production.

Branch base: `main` at `2a78fb894d3e15e8c5f0bc72bc1a0f5c7d0eaf54`.

## Clean staging install order
A new empty staging project should first apply:
- `migrations/20261104000000_gms_staging_schema_bootstrap.sql`

That bootstrap consolidates the historical source sequence: `schema.sql`, `migrations_20261102.sql`, `migrations_20261103.sql`, `migrations_20261104.sql`, and the dated feature SQL through `migrations_20261115_bulk_assignment_commit_fix.sql`.

Those historical scripts lived outside the timestamped migration folder, so they were not part of the 17-entry production migration ledger. The new bootstrap provides a repeatable clean install for isolated staging.

## Staging-specific resource controls
The bootstrap intentionally omits:
- pg_cron extension installation and recurring job creation;
- immediate cleanup/retention calls during install;
- push-dispatch HTTP scheduling, Vault secrets, and Edge Function deployment.

No scheduled jobs should be present after bootstrap. Scheduled workflows must be invoked manually for testing, only when separately approved.

The only seed rows retained are the sample locations and service templates from the original schema file. No production people, availability, assignments, notification history, or audit records are copied.

## Reconciled production ledger
The following 17 production migration versions are represented in `migrations/`:
1. `20261104101939_gms_security_hardening_01_function_execute_grants`
2. `20261104103051_gms_assignment_update_guard_and_anon_privilege_revoke`
3. `20261104103930_gms_security_hardening_03_trigger_grants_and_servant_activation`
4. `20261104103939_gms_security_hardening_03_trigger_grants_and_servant_activation`
5. `20261104105146_gms_security_hardening_04a_notification_queue_permissions`
6. `20261104110028_gms_push_queue_atomic_claims_and_retry_leases`
7. `20261104123415_gms_push_queue_claim_renewal_and_checkpoint_safe_retry`
8. `20261104131119_gms_push_subscription_least_privilege`
9. `20261104141242_gms_assignment_conflict_guards_serialized`
10. `20261104142005_gms_assignment_recurring_availability_guard`
11. `20261104142134_gms_fix_month_edges_availability_matcher`
12. `20261104142623_gms_publish_assignment_integrity_guard`
13. `20261104143030_gms_serving_request_relationship_guard`
14. `20261104144743_gms_atomic_schedule_save_and_servant_account_link`
15. `20261104150031_gms_atomic_schedule_lock_order_fix`
16. `20261104150214_gms_account_link_recurring_rule_conflict_guard`
17. `20261104151712_gms_schedule_edit_confirmation_reset`

## Reconstruction notes
Six SQL files were missing from both current branches. They have been reconstructed from the observed production catalog (function ACLs, assignment guard, trigger grants, account activation behavior, and queue/subscription table grants). They are not claimed to be byte-for-byte copies of the original applied SQL.

The push queue renewal migration exists in `develop` as `20261104111500_...`, while production records version `20261104123415`. The SQL body was checked against live production function definitions and queue columns; this branch uses the production ledger version.

Two production ledger entries share the same migration name at versions `20261104103930` and `20261104103939`; both timestamps are retained as distinct idempotent files.

## Required validation before staging apply
- Apply the clean bootstrap to an empty disposable database or isolated staging project.
- Confirm 18 application tables, all with RLS enabled.
- Confirm all 17 production migration source files are present and ordered.
- Confirm the queue is inaccessible to anon/authenticated, and subscriptions grant authenticated SELECT/DELETE only.
- Confirm no pg_cron jobs or push-dispatch configuration are present.
- Run regression tests for assignment confirmation, schedule saving, servant account linking, notifications, and availability guards.
- Do not merge this branch or apply production changes without separate approval.

## Known follow-up items
Production's `serving_notifications` comment says 180-day retention while the historical cleanup function is labeled 30-day. The staging bootstrap normalizes the comment to 30 days, but the production discrepancy must be reviewed before any production migration is proposed.

The historical `setup_push_dispatch.sql` is not included in the staging bootstrap. It contains a previously exposed dispatch secret and must not be used; rotate the credential and replace that setup procedure in a separately approved security phase.
