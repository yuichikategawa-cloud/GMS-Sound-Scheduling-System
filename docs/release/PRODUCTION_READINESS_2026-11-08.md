# Production Readiness — 2026-11-08

## Release objective

Prepare the GMS Sound Scheduling System for a controlled production promotion within
the six-hour target window. This document is a release gate, not authorization to
merge, deploy, or modify production.

## Current live baseline

- Latest confirmed Vercel Production deployment: READY.
- Production deployment source: `main`, commit
  `2a78fb894d3e15e8c5f0bc72bc1a0f5c7d0eaf54`.
- Last 24-hour Vercel runtime error query returned no runtime errors.
- Current production domains are assigned to the READY deployment.
- Production Supabase project: `zqpmzvhudxprzdfijrtu`.
- Staging Supabase project: `uurgomjrsvzfmcpsnitu`.

## Candidate branch status

- Candidate branch: `security/push-endpoint-hardening`.
- Candidate baseline: `583296a47912d680636ec9ccec3f99df436c2277` (the user-confirmed all-green Preview deployment `dpl_ExxHmhiBYyxDDwEHjQ3kVLNf74GF`, READY / HTTP 200).
- Current branch head after release-readiness additions: `bbb44f5ced47319131c0bd456707534697cd2ad1`.
- Current branch retains the baseline as its ancestor; compare against the baseline shows only release documentation plus the assignment-confirmation migration, its regression test, and CI wiring.
- The baseline is 459 commits ahead of main at the time of comparison, with 170 changed files, 19,896 additions, and 6,089 deletions.
- The candidate includes substantial application restructuring, CSS modularization,
  push-dispatch changes, database migrations, and regression tests. It is not a
  small production patch and must not be merged as an unreviewed bulk change.
- Full Phase 1 CI passed at code commit
  `583296a47912d680636ec9ccec3f99df436c2277`: SQL staging, Deno tests/type-check,
  and frontend TypeScript/Vite build all passed.
- Full CI has now passed again on the current release branch. Runs `42405517359`, `42405520973`, and `42405525583` each completed with all three jobs green (Deno, frontend build, staging SQL). The latest run `42405525583` includes the assignment-confirmation migration and regression test.
- Preview deployment is disabled for `security/push-endpoint-hardening` in
  `vercel.json`; the regression test passed in the full CI run.

## Production rollout status — 2026-11-08

Approved production database and Edge Function work has been completed:

- Applied `gms_push_subscription_endpoint_security` to production (Supabase migration history version `20261107192330`).
- Applied `gms_assignment_confirmation_notification_idempotency` to production (history version `20261107192334`).
- Verified both SECURITY DEFINER functions now use `search_path = pg_catalog, public`, grant EXECUTE only to `authenticated` (plus owner), and no longer grant it to `service_role`.
- Ran an isolated production registration smoke test: an unsupported `attacker.invalid` endpoint was rejected with `Push endpoint URL is not supported`. No subscription was created.
- Deployed hardened `dispatch-push` Edge Function version 4. Retrieved deployed source confirms `security.ts` is imported and shared lease/retry modules are included.
- Verified required Vault entries exist and are non-empty without retrieving their values.
- Verified all five production cron jobs remain active, with the existing `gms-dispatch-web-push` cadence unchanged at every minute. No cron job was added, removed, or rescheduled.
- Production still has zero push subscriptions. Real-device delivery and retry verification remain outstanding.

The application has **not** been merged to `main` and no Vercel Production deployment was made. The user’s approval covered the database migrations and hardened Edge Function deployment only.

## Production blockers / decisions

### 1. Push endpoint security — code and database hardening deployed; device verification outstanding

Read-only comparison found:

- Production `register_serving_push_subscription` now validates approved HTTPS
  endpoint hosts, subscription keys and user-agent bounds, and uses advisory
  locks to serialize endpoint ownership/account switching.
- Production `dispatch-push` version 4 imports `isAllowedPushEndpoint`, removes
  unsupported stored endpoints, and sends only to approved endpoints.
- Both environments currently have zero push subscriptions and zero pending queue
  rows. Production has 20 historical queue rows; staging has 6.
- Push cron is active in both environments, but staging runs every 5 seconds and
  production every minute.

Remaining before declaring push fully verified:
1. Register one real test device and verify delivery, retry behavior and endpoint
   rejection, then clean up the test subscription.
2. Confirm VAPID configuration through a real delivery test; do not expose values.
3. Keep the existing one-minute cron cadence unless a separately approved change
   is justified; preserve production-only cron jobs.

Do not apply staging's entire migration history to production.

### 2. Assignment-confirmation idempotency — RELIABILITY GATE

- Staging and production now use the hardened idempotent
  `notify_admin_assignment_confirmation` implementation with a stable
  per-confirmation-cycle event key.
- The canonical migration is included on the release branch at `supabase/migrations/20261107182600_gms_assignment_confirmation_notification_idempotency.sql`, with rollback-only regression at `supabase/tests/assignment_confirmation_notification_idempotency.sql`.
- GitHub Actions staging validation passed (run `42405525583`), and the migration is now applied in production.

### 3. Candidate promotion scope — BLOCKER until release scope is agreed

The candidate branch contains 170 changed files and nearly 20,000 additions
relative to main. The green full CI is valuable evidence, but it does not replace
a controlled diff review, production compatibility review, or browser QA.
Browser-based visual and interaction QA remains incomplete.

The user has explicitly selected the all-green Preview commit `583296a` as the full-feature production baseline. Preserve its complete application and modularization scope; do not substitute the older staging-only branch. Production promotion remains gated on database/Edge Function parity, final browser/device QA, and explicit approval.

### 4. Remaining verification

- Verify production and staging function definitions, ACLs, cron schedules and
  migration history immediately before any approved rollout.
- Re-check RLS policies and exposed SECURITY DEFINER RPC authorization.
- Confirm the production Vercel environment has the expected public Supabase URL,
  publishable browser key and VAPID public key; never copy secret values into this
  document or source control.
- Run a fresh production-targeted frontend build from the exact release commit.
- Perform browser QA for sign-in, password recovery, admin scheduling, assignment
  publication, servant inbox, confirmation, availability and notifications.
- Prepare rollback target and post-deploy smoke-test checklist before deployment.

## Safety boundaries

- No Preview deployment without explicit approval.
- No merge to `main` without explicit approval.
- No Production deployment without explicit approval.
- No production database, migration, Edge Function, cron, secret or Vercel
  configuration changes without explicit approval.
- Preserve production-only cron jobs and environment-specific configuration.
- Treat CI success, deployment readiness and browser QA as separate evidence.
