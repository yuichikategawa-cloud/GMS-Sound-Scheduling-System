# Phase 1 — Push endpoint security patch

## Base and branch
- Base: `main` at `2a78fb894d3e15e8c5f0bc72bc1a0f5c7d0eaf54`
- Branch: `security/push-endpoint-hardening`
- Scope: push subscription registration validation and outbound endpoint validation in the push dispatcher.

## Changes prepared
- Restrict registration to authenticated GMS admin/servant profiles.
- Allow HTTPS endpoints only from supported Google, Mozilla, Apple Web Push subdomains, and Microsoft WNS hosts.
- Validate endpoint length/control characters, P-256 key and auth key encodings, and user-agent length.
- Prevent cross-account endpoint takeover unless the caller supplies the exact previously registered key pair.
- Serialize endpoint ownership and per-user device-count changes; enforce a ten-device cap.
- Re-check stored endpoints immediately before outbound push calls and remove unsupported persisted endpoints rather than sending to them.
- Reuse the staging-tested queue claim, lease, checkpoint, and retry implementation. Notification content and assignment workflows are unchanged.

## Validation plan
1. Run Deno endpoint allowlist tests and dispatcher type-check.
2. Run `supabase/tests/push_registration_security.sql` against staging only. It requires two existing GMS profiles without push subscriptions and rolls all data changes back.
3. Re-run the staging Supabase security advisor and verify registration grants remain authenticated-only.
4. Confirm a staging Chrome/Android browser subscription and a physical-device push delivery using the staging VAPID key.
5. Review the deployed production worker diff against the staged worker before any production release.

## Rollback
- SQL migration: restore the previous function definition and grants only through a reviewed forward migration; do not restore broad anonymous execution or unrestricted endpoints.
- Edge Function: disable push dispatch or deploy a fail-closed worker if the new worker misbehaves. Do not revert to unrestricted endpoint delivery.
- Queue rows and notifications remain in the database; do not truncate or delete them as part of rollback.

## Deployment boundary
Prepared on an isolated branch only. No SQL was applied, no Edge Function was deployed, no secrets were read/changed, no Vercel environment was changed, no PR was opened, and `main` was not modified.
