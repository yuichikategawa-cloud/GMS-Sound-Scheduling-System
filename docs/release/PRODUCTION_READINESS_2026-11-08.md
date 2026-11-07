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

## Production blockers / decisions

### 1. Push endpoint security — BLOCKER if push is enabled at launch

Read-only comparison found:

- Staging `register_serving_push_subscription` validates supported HTTPS push
  endpoint hosts, validates subscription keys and user-agent bounds, and uses
  advisory locks to serialize endpoint ownership/account switching.
- Production's same RPC has only basic non-empty length validation, deletes an
  endpoint from another account, and upserts it without the staging allowlist or
  ownership-lock safeguards.
- Staging `dispatch-push` imports `isAllowedPushEndpoint`, removes unsupported
  stored endpoints, and sends only to approved endpoints.
- Production's deployed `dispatch-push` version 3 does not contain this endpoint
  validation.
- Both environments currently have zero push subscriptions and zero pending queue
  rows. Production has 20 historical queue rows; staging has 6.
- Push cron is active in both environments, but staging runs every 5 seconds and
  production every minute.

Required before enabling push in updated production:
1. Review the exact migration and edge-function bundle from the candidate branch.
2. Apply the endpoint-registration migration to production under an approved,
   controlled database rollout.
3. Deploy the complete hardened dispatcher bundle and required shared modules.
4. Verify the dispatcher secret and VAPID configuration without exposing values.
5. Register one real test device, verify delivery, retry behavior and endpoint
   rejection, then clean up the test subscription.
6. Decide separately whether the sub-minute cron cadence is required for launch;
   preserve production-only cron jobs.

Do not apply staging's entire migration history to production.

### 2. Assignment-confirmation idempotency — RELIABILITY GATE

- Staging has the hardened idempotent `notify_admin_assignment_confirmation`
  implementation with a stable per-confirmation-cycle event key.
- Production still has the older implementation, which inserts notifications
  without the same event-key deduplication.
- The canonical migration is now included on the release branch at `supabase/migrations/20261107182600_gms_assignment_confirmation_notification_idempotency.sql`, with rollback-only regression at `supabase/tests/assignment_confirmation_notification_idempotency.sql`.
- The latest GitHub Actions SQL-staging job applied the migration to staging and executed the regression successfully (run `42405525583`).
- Production still requires the same migration under a separately approved rollout. Do not apply it without explicit production approval and final review.

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
