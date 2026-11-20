# Supabase migration ledger crosswalk — 2026-11-09

## Scope and safety

Read-only inventory of the linked Supabase projects as checked on 2026-11-09:

- Production project: `zqpmzvhudxprzdfijrtu`
- Staging project: `uurgomjrsvzfmcpsnitu`
- Repository source baseline: `develop` at `e58d3a7dbb02c47813776728d59d49d64bacf1ee`

This document records live `supabase_migrations.schema_migrations` entries, compares their stored SQL statements with repository files, and checks selected current catalog state. It does **not** alter either database.

**Do not edit `supabase_migrations.schema_migrations` directly, delete the blank entries listed below, or run `supabase db push` merely to force version strings to match.** A version number in the two environments is not a safe indicator that a migration body is equivalent. Do not replay an already-applied operation simply because its repository filename has another timestamp.

## Executive summary

| Check | Production | Staging |
|---|---:|---:|
| Migration ledger rows | 25 | 30 |
| Rows with a non-empty migration name and SQL body | 25 | 27 |
| Blank/no-op ledger rows | 0 | 3 |
| Version IDs shared exactly between environments | 0 | 0 |

The two environments use different migration version sequences. A logical mapping exists for much of the history, but it is not a version-for-version mirror.

The 25 Production entries break down as follows:

- 16 have a canonical SQL file on current `develop` whose SQL body matches the Production ledger body (whitespace/trailing-newline normalized).
- 8 early Production entries have reconstructed equivalents on the older `chore/staging-migration-reconciliation` / `chore/staging-push-security-hardening` branches. Those files match the corresponding **Staging** ledger entries, but do **not** match the stored Production SQL bodies. They must not be described as byte-for-byte originals of Production's applied migrations.
- 1 Production-only parity reconciliation (`20261108070132`) has no canonical migration file in current `main` or `develop`; its SQL body remains available in the live Production ledger.

## Production-to-Staging crosswalk

“Staging counterpart” below means a logical/effect relationship, not identical version IDs. SQL comparisons were made against the stored migration statement text, not just the names.

| Production version | Production migration name | Staging counterpart | Current source / evidence |
|---|---|---|---|
| `20261104101939` | `gms_security_hardening_01_function_execute_grants` | `20261104165702` same name | Older branch file `supabase/migrations/20261104101939_...sql`; exact to Staging ledger, **different from Production SQL** |
| `20261104103051` | `gms_assignment_update_guard_and_anon_privilege_revoke` | `20261104165707` same name | Older branch file `supabase/migrations/20261104103051_...sql`; exact to Staging ledger, **different from Production SQL** |
| `20261104103930` | `gms_security_hardening_03_trigger_grants_and_servant_activation` | `20261104165712` `gms_security_hardening_03_trigger_grants` | Older branch file `supabase/migrations/20261104103930_...sql`; Staging split the grant portion into a distinct row; Production SQL differs |
| `20261104103939` | `gms_security_hardening_03_trigger_grants_and_servant_activation` | `20261104165716` `gms_security_hardening_03_servant_activation` | Older branch file `supabase/migrations/20261104103939_...sql`; Staging split servant activation into a distinct row; Production SQL differs |
| `20261104105146` | `gms_security_hardening_04a_notification_queue_permissions` | `20261104165722` same name | Older branch file `supabase/migrations/20261104105146_...sql`; exact to Staging ledger, **different from Production SQL** |
| `20261104110028` | `gms_push_queue_atomic_claims_and_retry_leases` | `20261104165731` same name | Older branch file `supabase/migrations/20261104110028_...sql`; exact to Staging ledger, **different from Production SQL** |
| `20261104123415` | `gms_push_queue_claim_renewal_and_checkpoint_safe_retry` | `20261104165736` same name | Older branch file `supabase/migrations/20261104123415_...sql`; exact to Staging ledger, **different from Production SQL** |
| `20261104131119` | `gms_push_subscription_least_privilege` | `20261104165742` same name | Older branch file `supabase/migrations/20261104131119_...sql`; exact to Staging ledger, **different from Production SQL** |
| `20261104141242` | `gms_assignment_conflict_guards_serialized` | `20261104165749` same name | Current `develop` file matches both Production and Staging stored SQL |
| `20261104142005` | `gms_assignment_recurring_availability_guard` | `20261104165755` same name | Current `develop` file matches both Production and Staging stored SQL |
| `20261104142134` | `gms_fix_month_edges_availability_matcher` | `20261104165805` same name | Current `develop` file matches both Production and Staging stored SQL |
| `20261104142623` | `gms_publish_assignment_integrity_guard` | `20261104165810` same name | Current `develop` file matches both Production and Staging stored SQL |
| `20261104143030` | `gms_serving_request_relationship_guard` | `20261104165814` same name | Current `develop` file matches both Production and Staging stored SQL |
| `20261104144743` | `gms_atomic_schedule_save_and_servant_account_link` | `20261104165820` same name | Current `develop` file matches both Production and Staging stored SQL |
| `20261104150031` | `gms_atomic_schedule_lock_order_fix` | `20261104165826` same name | Current `develop` file matches both Production and Staging stored SQL |
| `20261104150214` | `gms_account_link_recurring_rule_conflict_guard` | `20261104165832` same name | Current `develop` file matches both Production and Staging stored SQL |
| `20261104151712` | `gms_schedule_edit_confirmation_reset` | `20261104165837` same name | Current `develop` file matches both Production and Staging stored SQL |
| `20261107184510` | `gms_bulk_assignment_pending_request_guard` | `20261116000000` blank/no-op row | Current `develop` file `20261116000000_gms_bulk_assignment_pending_request_guard.sql` matches Production SQL exactly. Staging ledger row has no name or SQL body; RPC exists in both catalogs. |
| `20261107184551` | `gms_atomic_weekend_schedule_replace` | `20261117000000` blank/no-op row | Current `develop` file `20261117000000_gms_atomic_weekend_schedule_replace.sql` matches Production SQL exactly. Staging ledger row has no name or SQL body; RPC exists in both catalogs. |
| `20261107184607` | `gms_anonymous_public_privilege_hardening` | `20261118000000` blank/no-op row | Current `develop` file `20261118000000_gms_anonymous_public_privilege_hardening.sql` matches Production SQL exactly. Staging ledger row has no name or SQL body; the blank row is not proof of execution. |
| `20261107192330` | `gms_push_subscription_endpoint_security` | `20261105042202` same name | Current `develop` file `20261105042202_gms_push_subscription_endpoint_security.sql` matches Production SQL exactly. Staging's stored SQL differs in comments/formatting; after comment and whitespace normalization it matches the source. |
| `20261107192334` | `gms_assignment_confirmation_notification_idempotency` | Overlap with `20261104173402` composite hardening | Current `develop` file `20261107182600_gms_assignment_confirmation_notification_idempotency.sql` matches Production SQL exactly. Staging records the earlier combined notification/push hardening under one row; current function definition hash matches Production. |
| `20261108070132` | `production_approved_staging_parity_reconciliation` | No separate Staging ledger row | **No canonical SQL file found in current `main`/`develop`.** The Production ledger contains the operation. It restores the authenticated system-settings read policy, aligns `sync_member_profile_name()`, and adds `servant_serving_preferences_active_idx`. The policy, trigger, and index are present in Staging too; the normalized profile-sync function bodies match. |
| `20261109073533` | `gms_enforce_expired_serving_actions` | No same-name Staging ledger row | Current `develop` file `20261108010000_gms_enforce_expired_serving_actions.sql` matches Production SQL exactly. Current Staging and Production definitions of the request-insert guard, swap execution, and replacement resolution functions match after line-ending normalization. |
| `20261109073540` | `gms_enforce_availability_delete_deadline` | `20261109020727` same name | Current `develop` file `20261109010000_gms_enforce_availability_delete_deadline.sql` matches the Production body and the Staging body (whitespace/trailing-newline normalized). |

### Early migration provenance warning

The first eight Production entries above are **not recoverable as exact source files from current `main`/`develop`**. The older reconciliation branches contain reconstructed SQL files based on the observed Production catalog. The files match the corresponding Staging ledger bodies exactly, but a direct comparison with the Production ledger's stored SQL shows different bodies. Treat them as effect-based reconstructions, not the original Production SQL. Do not replay them into either live environment to “repair” history.

The nine entries from `20261104141242` through `20261104151712` are different: their current `develop` files match both environments' stored SQL.

## Staging-specific ledger entries

These entries are additional Staging history, not a reason to copy all Staging operations into Production.

| Staging version | Name | Source / comparison | Classification |
|---|---|---|---|
| `20261104164422` | `gms_staging_schema_bootstrap` | `20261104000000_gms_staging_schema_bootstrap.sql` on the older reconciliation branches | Staging clean-install bootstrap. It consolidates historical schema scripts and deliberately excludes scheduled jobs, Vault secrets and push dispatch setup. Only for an empty disposable Staging database; never run against a populated project. |
| `20261104173402` | `gms_notification_push_subscription_hardening` | Exact to `20261104170500_gms_notification_push_subscription_hardening.sql` on `chore/staging-push-security-hardening` | Earlier combined notification/push hardening. Production later tracks endpoint security and assignment-confirmation idempotency as separate rows. |
| `20261104180625` | `gms_availability_touch_search_path` | Exact to `20261105100000_gms_availability_touch_search_path.sql` on `chore/staging-push-security-hardening` | Staging-specific function search-path hardening. |
| `20261105003900` | `gms_apple_push_subdomain_allowlist` | Related file `20261105110000_gms_apple_push_subdomain_allowlist.sql` exists on the older push-hardening branch, but the stored Staging SQL does **not** match that file after comment/whitespace normalization | Historical intermediate; preserve the ledger evidence and rely on the later regex-fix and final function-state checks, not the older source snapshot. |
| `20261105004020` | `gms_apple_push_regex_escape_fix` | Exact to `20261105112000_gms_apple_push_regex_escape_fix.sql` on `chore/staging-push-security-hardening` | Staging-specific follow-up fixing regex escaping. |
| `20261105063544` | `enable_staging_push_dispatch_extensions` | No standalone migration file found. The two extension-creation statements also appear in `supabase/setup_push_dispatch.sql`, which additionally configures Vault and cron and must not be rerun wholesale. | Staging environment setup; source-control gap for the isolated two-statement operation. |
| `20261105071138` | `20261105070744_gms_push_dispatch_subminute` | Current `develop` file `20261105071138_gms_push_dispatch_subminute.sql` exists but does not match the stored Staging migration SQL | Historical variant. The live push-dispatch cron schedule is five seconds in both environments and the normalized cron command matches. Do not replay to normalize history. |
| `20261109112851` | `revoke_authenticated_public_truncate` | Equivalent to `20261119000000_revoke_authenticated_public_truncate.sql` on the unmerged `security/revoke-authenticated-truncate` branch (same SQL after comment/whitespace normalization) | Staging-only security hardening; not in current `main`/`develop`. Production still needs a separately reviewed decision on this privilege gap. |

### Blank Staging rows

Staging contains three rows with blank names, empty `statements`, and empty `rollback` arrays:

- `20261116000000`
- `20261117000000`
- `20261118000000`

These match the timestamps of three canonical files in current `develop`, but the Staging rows contain no SQL at all. The corresponding bulk-assignment and weekend-replacement RPCs are present in both live catalogs; that does not establish that these empty rows recorded those operations. Do not delete, rename, or fill these entries by writing directly to Supabase's internal migration table. Determine how they were created before any ledger repair.

## Verified current catalog differences

### Security: authenticated TRUNCATE grants

A read-only privilege query found that Production grants the `authenticated` role `TRUNCATE` on 15 public tables, while Staging grants it on zero public tables.

Production tables with the grant:

`assignments`, `audit_logs`, `locations`, `member_profiles`, `profiles`, `schedules`, `servant_availability`, `servant_availability_rules`, `servant_serving_preferences`, `servants`, `service_templates`, `serving_notification_preferences`, `serving_request_reads`, `serving_requests`, `system_settings`.

This is an effective privilege difference, not merely a migration timestamp difference. Staging's `revoke_authenticated_public_truncate` row accounts for the safer Staging state. PostgreSQL `TRUNCATE` is not filtered by row-level security. Review and promote this hardening through a dedicated migration/CI review; it was **not** applied to Production as part of this audit.

### Selected function and schema state

The following were checked read-only:

- `admin_bulk_assignments_grouped(jsonb,text)`, `admin_replace_generated_weekend_schedules(jsonb)`, and `notify_admin_assignment_confirmation(uuid)` exist in both catalogs.
- `notify_admin_assignment_confirmation(uuid)` has the same current definition hash in both databases.
- `gms_validate_serving_request_insert()`, `admin_execute_servant_swap()`, `admin_resolve_replacement()`, `gms_guard_dated_availability_write()`, and `gms_guard_recurring_availability_write()` have matching current definitions after line-ending/case/format normalization as applicable.
- The push-subscription registration function has matching SQL after comments and whitespace are normalized. Its raw definition hashes differ because the live text contains comment/formatting differences.
- The authenticated read policy on `system_settings`, the `member_profile_name_sync` trigger, and `servant_serving_preferences_active_idx` exist in both databases. The normalized `sync_member_profile_name()` definitions match.

These checks confirm selected current effects; they are not a complete schema dump or a substitute for per-migration runtime regression tests.

### Cron jobs are intentionally not identical

| Job | Production | Staging |
|---|---|---|
| `gms-auto-confirm-d1` | Active | Not present |
| `gms-clean-expired-availability` | Active | Not present |
| `gms-daily-serving-reminders` | Active | Not present |
| `gms-dispatch-web-push` | Active, every 5 seconds | Active, every 5 seconds |
| `gms-notification-audit-30day-retention` | Active | Not present |
| `gms-cron-history-cleanup` | Not present | Active |

The live `gms-dispatch-web-push` command is the same after whitespace normalization. Keep auto-confirmation, reminders, retention and cron-history cleanup environment-specific unless there is a separately approved Staging schedule design. Do not copy Production cron jobs or Vault secrets into Staging to make the ledgers look alike.

## Safe reconciliation plan

1. Keep the live migration ledgers untouched while the mapping is reviewed.
2. Decide whether to preserve recovered historical SQL as **archival evidence outside** `supabase/migrations/`; do not put reconstructed historical scripts into the active migration folder where a future migration runner could replay them.
3. Resolve the eight early Production source gaps from the actual Production ledger text before claiming the repository is a complete historical source of truth.
4. Recover and source-control the one-off `production_approved_staging_parity_reconciliation` statement as historical documentation (not as a new migration to rerun).
5. Investigate the three empty Staging ledger rows and the Staging-only extension/sub-minute entries. Do not repair them with direct SQL writes.
6. Review the authenticated `TRUNCATE` privilege difference as a separate security change, with a focused migration and regression test, before any Production promotion.
7. Keep Staging-specific bootstrap and resource-control decisions separate from Production migrations and cron configuration.

## Work performed for this snapshot

- Read-only Supabase queries against both projects.
- Read-only comparison of stored migration SQL with current/older repository files.
- Read-only catalog, privilege and cron inventory.
- No SQL migrations applied; no migration ledger rows edited; no Edge Functions, secrets, cron jobs, or GitHub settings changed. Only this documentation branch was created/updated; `develop` and `main` were not changed. Vercel created Git-triggered attempts for the documentation commits, but the project's Ignored Build Step canceled them (exit code 0) before any deployment became Ready; no Preview or Production deployment was produced.
