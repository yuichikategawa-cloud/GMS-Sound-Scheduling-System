# Phase 1 — Push endpoint security patch

## Base and branch
- Base: `main` at `2a78fb894d3e15e8c5f0bc72bc1a0f5c7d0eaf54`
- Working branch: `security/push-endpoint-hardening`
- Current working branch tip at this review: `3f0a1f48c71df97ee7c6dad3f1c5ee88280112ba`.
- Last full CI validation: run `41990087590` (run 19), all jobs passed including the frontend production build.
- Scope: push subscription registration, outbound endpoint validation, dispatch queue reliability, and regression coverage.

## Changes prepared
- Restrict registration to authenticated GMS admin/servant profiles.
- Allow HTTPS endpoints only from supported Google, Mozilla, Apple Web Push subdomains, and Microsoft WNS hosts.
- Validate endpoint length/control characters, P-256 key and auth key encodings, and user-agent length.
- Prevent cross-account endpoint takeover unless the caller supplies the exact previously registered key pair.
- Serialize endpoint ownership and per-user device-count changes; enforce a ten-device cap.
- Re-check stored endpoints immediately before outbound push calls and remove unsupported persisted endpoints rather than sending to them.
- Use atomic queue claiming, lease renewal/checkpointing, retry backoff, and bounded attempts for dispatch processing.
- Preserve the existing notification content and assignment workflows.

## Staging deployment and verification
- Staging Supabase project: `uurgomjrsvzfmcpsnitu`.
- Staging migration `20261105042202_gms_push_subscription_endpoint_security` is applied. The branch migration file is now named with this same recorded version; its function definition and ACL were compared with the live staging function/grants before aligning the filename.
- Staging Edge Functions `dispatch-push` and `username-login` are ACTIVE. The current `dispatch-push` deployment is version 3 with `verify_jwt=false`; the dispatcher performs its own shared-secret authentication. Its `index.ts`, endpoint-security module, lease keeper, and retry helper are byte-for-byte identical to the security branch.
- Validation workflow run `41990087590` (run 19) passed all three jobs on commit `3f0a1f48c71df97ee7c6dad3f1c5ee88280112ba`: `sql-staging` passed the staging-secret guard and both rollback-only SQL regressions; `deno` passed endpoint/queue helper tests and dispatcher type-check; `frontend` installed dependencies and passed `npm run build` (TypeScript + Vite). Run 18 (`41989324829`) also passed the initial frontend build job.
- The admin RPC regression now also asserts authenticated-vs-anonymous function grants and checks that `is_admin()` returns false for a servant and true for an administrator.
- Staging has one iPhone Web Push subscription on the servant profile. Controlled staging notifications were created and delivered to that iPhone; the user confirmed the banner appeared and tapping it opened GMS on the Inbox tab. Queue records show successful delivery to one Apple endpoint with no retry/error. The user also confirmed the corresponding Inbox item remains marked Read after refreshing.
- Android delivery remains waived/unverified because the user has no Android device. iPhone physical-device delivery, notification tap navigation, Inbox rendering, and read-state persistence after refresh are verified.
- iPhone/iPadOS compatibility was checked against Apple's current Web Push documentation: iOS/iPadOS 16.4 or later supports Web Push for Home Screen web apps. The app manifest uses `display: standalone`; the page registers a service worker; the worker handles `push` by immediately calling `showNotification`; and the outbound endpoint validator accepts Apple Web Push subdomains such as `web.push.apple.com`.
- The UI now instructs iPhone/iPad users to use Safari → Share → Add to Home Screen, turn on **Open as Web App**, then open the installed icon before enabling push. It also detects iPadOS desktop-mode devices and provides a Settings recovery hint when notification permission is denied.
- The push registration SQL regression now explicitly creates and verifies a valid `web.push.apple.com` endpoint inside its rollback-only test transaction.
- Live staging has one valid `web.push.apple.com` subscription associated with a servant profile. The stored user-agent identifies iPhone Safari/iOS, and both stored subscription-key encodings pass format/length validation. Controlled test notifications have been delivered successfully to this device; the user confirmed display and click-through to Inbox.
- Staging has `pg_cron` 1.6.4, `pg_net` 0.20.4, and the three required Vault entries. The notification-to-queue trigger is active. The dispatcher job was tuned from every minute to every 5 seconds and now invokes the Edge Function only when an unprocessed queue row is eligible (retry time reached and lease absent/expired).
- The user completed physical iPhone testing: subscription registration, notification banner display, notification tap opening the GMS Inbox, and Read-state persistence after refresh are verified.

## Frontend UI review (branch-only; preview not yet deployed)
- Removed the church icon from the account registration card; the password-recovery screen retains its separate brand mark.
- Corrected the registration CG-day fieldset so its legend occupies a full row and checkbox labels wrap predictably. Desktop/tablet uses two columns; narrow screens use one column. The fieldset no longer clips its options.
- Corrected the generation-guidance dark-mode selectors to target the actual `.app-shell[data-theme="dark"]` element, and increased text/icon contrast.
- Frontend build passes in CI. These are code/build-verified only; actual visual acceptance is pending one consolidated Vercel preview after the deployment quota resets. No Vercel deployment was made for these commits.
- GitHub Actions now runs the frontend TypeScript/Vite production build on relevant frontend changes, in addition to Deno and staging SQL regression jobs.
## Security advisor findings and interpretation
- The advisor reports nine authenticated-callable SECURITY DEFINER functions: six admin workflow RPCs, `is_admin()`, `notify_admin_assignment_confirmation()`, and `register_serving_push_subscription()`.
- Staging ACL inspection confirms all nine are executable by `authenticated` and none by `anon`; neither `authenticated` nor `anon` can create objects in the `public` schema.
- The six admin workflow RPCs explicitly call `public.is_admin()` before performing their protected work; the staging regression verifies that a servant identity is rejected and an administrator identity reaches the expected input/resource validation.
- `is_admin()` returns only the role result for `auth.uid()` and is used by row-level security policies.
- `notify_admin_assignment_confirmation()` requires an authenticated user, checks that the assignment belongs to that user's linked servant account, and requires the assignment to be confirmed.
- `register_serving_push_subscription()` requires an authenticated GMS admin/servant profile and validates the endpoint, subscription keys, ownership transition, and per-account device limit.
- These grants are required by the current authenticated application RPC flows. Revoking authenticated execution wholesale would break those flows; the advisor warning is retained as a documented, code-guarded exception, not treated as a clean scan.
- The advisor also reports `serving_push_queue` has RLS enabled without user policies. This is intentional: queue access is service-role-only.
- Leaked-password protection is still disabled in staging. It has not been changed as part of this work and remains an outstanding Auth hardening decision.

## Remaining validation and release gates
1. Decide/approve the production remediation plan; production currently has older endpoint-registration and dispatcher code (see the production comparison below).
2. Rotate the exposed production `PUSH_DISPATCH_SECRET` before any production release; it has not been rotated.
3. Apply the reviewed endpoint-registration migration and matching dispatcher worker to production only after explicit approval, then run production-specific release checks.
4. Validate production VAPID configuration and a controlled production delivery only after explicit approval.
5. Obtain explicit approval before any merge to `main`, production secret change, production database migration, or production deployment.

## Dispatcher latency improvement (staging)
- Evidence from the foreground test showed notification creation at 13:56:04 Jakarta time, Inbox fetch at 13:56:26, and queue processing at 13:57:01. The one-minute Cron interval explained the delayed banner.
- The staging migration file is `20261105071138_gms_push_dispatch_subminute.sql` (aligned with the recorded staging migration version) and schedules `gms-dispatch-web-push` every 5 seconds and gates HTTP invocation on an eligible queue row. The dispatcher's atomic claim/lease/retry implementation is unchanged.
- Verified live staging Cron schedule is `5 seconds`, active. Consecutive runs completed successfully every five seconds; when no queue item was eligible they returned `0 rows` and made no HTTP request. Pending eligible queue count was zero after the tests.
- A daily cleanup job removes Cron run-history rows older than seven days to bound the increased run-history volume.
- The setup script now documents the five-second schedule and the required PostgreSQL 15.1.1.61+ version.

## Production comparison (read-only; no production changes)
- Production dispatch-push is ACTIVE at version 3 with verify_jwt=false. Its leaseKeeper.ts, retryBackoff.ts, and deno.json match staging, but its index.ts differs and it has no separate security.ts file. The staging worker explicitly validates stored subscription endpoints before sending and removes endpoints outside the browser push-service allowlist; the current production worker does not.
- Production register_serving_push_subscription() is still the older SECURITY DEFINER function with search_path=public. It only checks minimum string lengths, does not validate endpoint hosts or Web Push key encodings, does not require a GMS admin/servant profile, has no per-account ten-device cap or endpoint/user advisory-lock protection, and deletes an endpoint from another user before registering it. Its current ACL is authenticated only (not anon). This is a material production security gap; the staging migration is intended to close it.
- Production gms-dispatch-web-push remains active every minute; staging is active every five seconds with an eligible-queue guard. No production Cron schedule was changed.
- Production and staging both have RLS enabled on serving_push_queue with no user policies, which is intentional because queue access is restricted to service-role functions. serving_notifications retains authenticated own-row read/update policies and serving_push_subscriptions retains its authenticated policy.
- Staging VAPID configuration is operationally validated by successful Apple Web Push delivery and visible iPhone banners. No secret values were read or printed; no separate offline key-material comparison was performed. Production VAPID configuration has not been independently validated.
## Additional credential hygiene finding
- The public default branch contained hard-coded production-target setup values, including a high-entropy push-dispatch credential literal, in `supabase/setup_push_dispatch.sql`. Treat that dispatch credential as exposed and rotate the corresponding production `PUSH_DISPATCH_SECRET` before any production release. The security branch version of the setup file now uses placeholders only; the public `main` branch and its Git history have not been changed, and no production credential was rotated as part of this staging task.
- The production credential rotation is a separate, explicit approval gate. Removing the literal from the current branch file does not erase it from prior public Git history.

## Rollback
- SQL migration: restore the previous function definition and grants only through a reviewed forward migration; do not restore broad anonymous execution or unrestricted endpoints.
- Edge Function: disable push dispatch or deploy a fail-closed worker if the new worker misbehaves. Do not revert to unrestricted endpoint delivery.
- Queue rows and notifications remain in the database; do not truncate or delete them as part of rollback.

## Deployment boundary and deployment minimization
Staging-only changes have been applied as listed above. Production was inspected read-only; no production SQL, production Edge Function, production secrets, production Cron schedule, production Vercel environment, or production deployment has been changed. `main` remains untouched; the security branch remains unmerged and has no pull request open.
- Deployment policy: batch related UI/code changes; prefer local/static checks and GitHub CI; create a Vercel preview only when browser/integration validation materially requires it; reuse a valid preview where possible; never use production deploys as a test mechanism.
- The latest preview attempt was blocked by Vercel's daily deployment API quota (HTTP 402). No workaround or plan/team setting was changed. The visual UI fixes remain pending preview verification.
