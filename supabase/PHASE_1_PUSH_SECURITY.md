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
- The last confirmed full validation workflow passed both jobs at commit `28c78c42da37f2356cd56185c625fd22278e0c45`: Deno endpoint/queue tests and dispatcher type-check; plus rollback-only push-registration and admin-RPC SQL regressions. The subsequent `is_admin()` and anonymous-grant assertions require a fresh workflow pass before this branch is treated as fully revalidated.
- The admin RPC regression now also asserts authenticated-vs-anonymous function grants and checks that `is_admin()` returns false for a servant and true for an administrator.
- Staging currently has one admin profile and one servant profile, but no schedules, assignments, push subscriptions, queued pushes, or serving notifications. The database regression tests roll back their temporary changes.
- No physical-device push delivery has been confirmed. The user does not have an Android device available, so Android/device delivery validation remains waived/unverified rather than passed.

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
1. Complete any remaining staging regression checks and inspect fresh security advisor output.
2. Perform a real browser subscription and end-to-end push delivery when a supported test device/browser is available.
3. Verify the VAPID public/private key pair as a cryptographic pair without exposing either secret.
4. Review the deployed production worker diff against staging before any production release.
5. Obtain explicit approval before any merge to `main`, production secret change, production database migration, or production deployment.

## Rollback
- SQL migration: restore the previous function definition and grants only through a reviewed forward migration; do not restore broad anonymous execution or unrestricted endpoints.
- Edge Function: disable push dispatch or deploy a fail-closed worker if the new worker misbehaves. Do not revert to unrestricted endpoint delivery.
- Queue rows and notifications remain in the database; do not truncate or delete them as part of rollback.

## Deployment boundary
Staging-only changes have been applied as listed above. No production SQL, production Edge Function, production secrets, production Vercel environment, or production deployment has been changed. `main` remains untouched; the security branch is 22 commits ahead of `main` and zero commits behind at the latest comparison, and no pull request or merge has been opened.
