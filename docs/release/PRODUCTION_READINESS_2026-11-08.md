# Production Readiness — 2026-11-09

## Release objective

Prepare a controlled production release of the GMS Sound Scheduling System. This
document records the verified release state and remaining gates; it is not, by
itself, authorization to merge or deploy.

## Current production baseline

- Current Vercel Production deployment: READY.
- Deployment ID: `dpl_5e37wxpkM1BjyXwHs3v1w3TLd3JL`.
- Source branch: `security/push-endpoint-hardening`.
- Source commit: `583296a47912d680636ec9ccec3f99df436c2277`.
- Production domain remains assigned to that deployment; no traffic switch has
  occurred during this review.
- Production Supabase project: `zqpmzvhudxprzdfijrtu`.
- Staging Supabase project: `uurgomjrsvzfmcpsnitu`.

## Current application candidate

- Candidate branch: `develop`.
- Exact candidate commit: `1113227e0e505b7bfef334b833eeb5d9868594c6`.
- Candidate Preview deployment: `dpl_4FKxEDqo74cyhDhxE4sjVweTtatL` — READY.
- Preview source metadata confirms the exact branch and commit above.
- The candidate's Vercel status check is successful. This proves the Vercel
  deployment build completed; it does not prove GitHub Actions or browser QA.
- GitHub's commit-workflow lookup returned no workflow runs for this exact SHA.
  The only combined status currently visible for the SHA is the Vercel success
  status. Therefore a fresh full GitHub Actions pass on this exact candidate is
  **not verified**.
- The Vercel build completed `npm run build` (`tsc -b && vite build`) and
  reached READY. Build output included non-fatal npm configuration/install
  policy warnings; no build failure was reported.
- The user visually checked the recent mobile schedule-template action controls
  on the Preview. This is a focused visual check, not end-to-end application QA.

## Branch topology and release strategy

- Current `main` head: `84ba17ccc6c01a6919415d8ba74aeeee45684bbd`.
- `develop` and `main` have diverged substantially (476 commits ahead and
  1 commit behind in the latest recorded comparison).
- Do **not** merge `develop` wholesale into `main` as a release shortcut.
- The previously attempted promotion of the Preview deployment was rejected
  with HTTP 422. No production promotion or alias change resulted.
- A possible controlled route is a new Vercel Production-targeted deployment
  from the exact reviewed Git commit, but only after all release gates pass and
  the user explicitly authorizes that deployment. This route must be validated
  against the actual Vercel project configuration before use.

## Production database rollout — approved work completed

The user explicitly approved the following two production migrations:

1. `20261108010000_gms_enforce_expired_serving_actions.sql`
2. `20261109010000_gms_enforce_availability_delete_deadline.sql`

Both are recorded in production migration history (applied versions
`20261109073533` and `20261109073540`, respectively). Post-application
verification confirmed that these five production function definitions match
the previously verified staging definitions:

- `admin_execute_servant_swap`
- `gms_guard_dated_availability_write`
- `gms_guard_recurring_availability_write`
- `gms_validate_serving_request_insert`
- `guard_servant_assignment_update`

The dated and recurring availability guards now include DELETE handling.
The earlier production notification-idempotency migration is already present
in production history as version `20261107192334`; do not reapply it merely
because its canonical source filename carries a different timestamp.

Other production security work recorded in the prior release review includes
push endpoint validation, notification idempotency, and hardened
`dispatch-push` Edge Function version 4. Real-device push delivery/retry
verification remains outstanding. Production cron cadence was intentionally
left unchanged.

## Remaining release gates

### 1. Exact-commit CI evidence

- Obtain a fresh full CI run associated with candidate SHA
  `1113227e0e505b7bfef334b833eeb5d9868594c6`.
- Confirm frontend TypeScript/Vite build, selected Deno regression tests, and
  SQL regression-source checks all pass.
- The current SQL workflow job checks rollback-only test source structure and
  assertions; it explicitly does not execute the SQL against live staging.
  Treat live database execution as a separate validation step.

### 2. Browser and functional QA

End-to-end browser QA is not yet evidenced for this candidate. Verify at minimum:

- Sign-in, username authentication, and password recovery.
- Admin schedule creation/editing, templates, bulk assignment, publishing and
  unpublishing.
- Availability submission, deadline behavior, and recurring availability.
- Assignment eligibility, conflicts, confirmation, and expired-service guards.
- Swap/replacement requests, servant inbox, and notification behavior.
- Mobile layouts and dark-mode readability across the key workflows.
- Push subscription registration, real-device delivery, retry behavior, and
  cleanup of the test subscription.

Record the tested device/browser, account role, result, and any defects. Do not
claim a feature is production-verified based only on compilation or source tests.

### 3. Production deployment readiness

Before a Production-targeted deployment:

- Reconfirm exact candidate SHA and branch metadata.
- Reconfirm production/staging migration history, critical function definitions,
  RLS/RPC permissions, Edge Function version, and cron schedules.
- Verify required Vercel Production environment configuration without exposing
  secret values.
- Confirm the Production build reaches READY and is built from the intended SHA.
- Preserve the current Production deployment as the rollback target.
- Prepare post-deploy smoke tests for authentication, scheduling, availability,
  swaps, inbox, and notifications.

No Vercel Production deployment has been created from candidate
`1113227`, and no live domain/alias has been switched as part of this review.

## Safety boundaries

- No additional Preview deployment without explicit approval.
- No merge to `main` without explicit approval.
- No Production deployment or traffic switch without explicit approval.
- No additional production database migration, Edge Function, cron, secret, or
  Vercel project configuration change without explicit approval.
- Preserve production-only cron jobs and environment-specific configuration.
- Do not merge the divergent `develop` branch wholesale into `main`.
- Treat CI, Vercel deployment readiness, browser QA, and live-device tests as
  separate evidence.
