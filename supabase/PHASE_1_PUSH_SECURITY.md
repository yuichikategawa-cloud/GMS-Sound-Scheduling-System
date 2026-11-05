# Phase 1 — Push endpoint security patch

## Base and branch
- Base: `main` at `2a78fb894d3e15e8c5f0bc72bc1a0f5c7d0eaf54`
- Working branch: `security/push-endpoint-hardening`
- Last reviewed test-code commit: `df3fd182d83dfdd3eed604e8371a446497e1738e`; migration filename alignment followed on the same branch.
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
- Staging Edge Functions `dispatch-push` and `username-login` are ACTIVE. The current `dispatch-push` deployment is version 2 with `verify_jwt=false`; the dispatcher performs its own shared-secret authentication.
- The latest full validation workflow (run `41980335911`, run number 14) passed at commit `2147d194c3e201854a3044d54119d9847f718c40`: the SQL job passed the required staging-secret guard and both rollback-only SQL regressions; the Deno job passed endpoint/queue tests and dispatcher type-check. This includes the Apple `web.push.apple.com` registration test, device-cap regression adjusted to preserve existing subscriptions, `is_admin()` identity checks, and anonymous-grant assertions. The subsequent setup-script/documentation changes do not change those test inputs.
- The admin RPC regression now also asserts authenticated-vs-anonymous function grants and checks that `is_admin()` returns false for a servant and true for an administrator.
- Staging has one iPhone Web Push subscription on the servant profile. Controlled staging notifications were created and delivered to that iPhone; the user confirmed the banner appeared and tapping it opened GMS on the Inbox tab. Queue records show successful delivery to one Apple endpoint with no retry/error. The user-facing read-state persistence check remains outstanding.
- Android delivery remains waived/unverified because the user has no Android device. iPhone physical-device delivery and notification tap navigation are verified; read/unread persistence after refresh is not yet verified.
- iPhone/iPadOS compatibility was checked against Apple's current Web Push documentation: iOS/iPadOS 16.4 or later supports Web Push for Home Screen web apps. The app manifest uses `display: standalone`; the page registers a service worker; the worker handles `push` by immediately calling `showNotification`; and the outbound endpoint validator accepts Apple Web Push subdomains such as `web.push.apple.com`.
- The UI now instructs iPhone/iPad users to use Safari → Share → Add to Home Screen, turn on **Open as Web App**, then open the installed icon before enabling push. It also detects iPadOS desktop-mode devices and provides a Settings recovery hint when notification permission is denied.
- The push registration SQL regression now explicitly creates and verifies a valid `web.push.apple.com` endpoint inside its rollback-only test transaction.
- Live staging has one valid `web.push.apple.com` subscription associated with a servant profile. The stored user-agent identifies iPhone Safari/iOS, and both stored subscription-key encodings pass format/length validation. Controlled test notifications have been delivered successfully to this device; the user confirmed display and click-through to Inbox.
- Staging has `pg_cron` 1.6.4, `pg_net` 0.20.4, and the three required Vault entries. The notification-to-queue trigger is active. The dispatcher job was tuned from every minute to every 5 seconds and now invokes the Edge Function only when an unprocessed queue row is eligible (retry time reached and lease absent/expired).
- The user completed physical iPhone testing: subscription registration, notification banner display, and notification tap opening the GMS Inbox are verified. Read-state persistence after refreshing Inbox remains the final outstanding UI check.

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
1. Complete the iPhone notification read-state persistence check after refresh.
2. Re-run the full branch CI workflow after the new sub-minute dispatcher migration and setup-script changes.
3. Verify the VAPID public/private key pair as a cryptographic pair without exposing either secret.
4. Review the deployed production worker diff against staging before any production release.
5. Treat the exposed production dispatch credential rotation as mandatory before production release; it has not been rotated.
6. Obtain explicit approval before any merge to `main`, production secret change, production database migration, or production deployment.

## Dispatcher latency improvement (staging)
- Evidence from the foreground test showed notification creation at 13:56:04 Jakarta time, Inbox fetch at 13:56:26, and queue processing at 13:57:01. The one-minute Cron interval explained the delayed banner.
- The staging migration file is `20261105071138_gms_push_dispatch_subminute.sql` (aligned with the recorded staging migration version) and schedules `gms-dispatch-web-push` every 5 seconds and gates HTTP invocation on an eligible queue row. The dispatcher's atomic claim/lease/retry implementation is unchanged.
- Verified live staging Cron schedule is `5 seconds`, active. Consecutive runs completed successfully every five seconds; when no queue item was eligible they returned `0 rows` and made no HTTP request. Pending eligible queue count was zero after the tests.
- A daily cleanup job removes Cron run-history rows older than seven days to bound the increased run-history volume.
- The setup script now documents the five-second schedule and the required PostgreSQL 15.1.1.61+ version.

## Additional credential hygiene finding
- The public default branch contained hard-coded production-target setup values, including a high-entropy push-dispatch credential literal, in `supabase/setup_push_dispatch.sql`. Treat that dispatch credential as exposed and rotate the corresponding production `PUSH_DISPATCH_SECRET` before any production release. The security branch version of the setup file now uses placeholders only; the public `main` branch and its Git history have not been changed, and no production credential was rotated as part of this staging task.
- The production credential rotation is a separate, explicit approval gate. Removing the literal from the current branch file does not erase it from prior public Git history.

## Rollback
- SQL migration: restore the previous function definition and grants only through a reviewed forward migration; do not restore broad anonymous execution or unrestricted endpoints.
- Edge Function: disable push dispatch or deploy a fail-closed worker if the new worker misbehaves. Do not revert to unrestricted endpoint delivery.
- Queue rows and notifications remain in the database; do not truncate or delete them as part of rollback.

## Deployment boundary
Staging-only changes have been applied as listed above. No production SQL, production Edge Function, production secrets, production Vercel environment, or production deployment has been changed. `main` remains untouched; the security branch remains unmerged and has no pull request open.
