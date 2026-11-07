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
- Candidate head at time of review:
  `8aa1ba59d52ee9f15df3286fc8061f27388a2eef`.
- Branch is 458 commits ahead of main and 0 behind.
- Compare with main: 170 changed files, 19,896 additions, 6,089 deletions.
- The candidate includes substantial application restructuring, CSS modularization,
  push-dispatch changes, database migrations, and regression tests. It is not a
  small production patch and must not be merged as an unreviewed bulk change.
- Full Phase 1 CI passed at code commit
  `583296a47912d680636ec9ccec3f99df436c2277`: SQL staging, Deno tests/type-check,
  and frontend TypeScript/Vite build all passed.
- The later candidate commit `8aa1ba5` changes documentation only. The CI workflow
  path filter does not include `docs/**`, so no new run was triggered for that commit.
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
- Draft PR #5 contains the canonical migration and rollback-only regression test:
  https://github.com/yuichikategawa-cloud/GMS-Sound-Scheduling-System/pull/5
- PR #5 is open, draft, unmerged. Its frontend build CI passed, but GitHub Actions
  does not execute the SQL assertions. Core runtime behavior was separately
  exercised in staging through a rollback/cleanup test block.
- Do not merge or apply the migration without explicit approval and final review.

### 3. Candidate promotion scope — BLOCKER until release scope is agreed

The candidate branch contains 170 changed files and nearly 20,000 additions
relative to main. The green full CI is valuable evidence, but it does not replace
a controlled diff review, production compatibility review, or browser QA.
Browser-based visual and interaction QA remains incomplete.

For the six-hour objective, prefer a narrowly scoped release over a wholesale
unreviewed promotion. Separate must-have launch fixes from optional modularization
and refactoring if the release scope cannot be reviewed in time.

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
