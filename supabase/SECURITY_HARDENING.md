# Notification and Push Subscription Hardening

## Scope

This change follows the staging-only authorization review. It hardens two authenticated notification entry points and the push delivery worker:

- `notify_admin_assignment_confirmation(uuid)` deduplicates notifications per real confirmation transition.
- `register_serving_push_subscription(...)` validates browser subscription inputs, serializes concurrent registration, limits device registrations, and prevents endpoint takeover by a caller who only knows another account's endpoint URL.
- `dispatch-push` sends only to a fixed allowlist of browser push-service origins, including for pre-existing rows.
- The app's disable action deletes only the signed-in user's matching row and checks the delete result before unsubscribing the browser endpoint.

This does not change administrator authorization, servant assignment rules, schedule publication, notification preferences, or the manual assignment workflow.

## Database migrations

The notification / push subscription migration below has already been applied to the dedicated staging project and verified there. It has not been applied to production:

- `supabase/migrations/20261104170500_gms_notification_push_subscription_hardening.sql`

A separate follow-up migration has been prepared to pin the availability timestamp trigger's search path. It is source-only and has not been applied to staging or production:

- `supabase/migrations/20261105100000_gms_availability_touch_search_path.sql`

The follow-up keeps the trigger as SECURITY INVOKER, explicitly sets `search_path` to `pg_catalog` only, and qualifies `pg_catalog.now()`. The read-only post-migration assertion is in `supabase/tests/availability_touch_search_path.sql`.

The notification event key includes the assignment ID, the latest audited transition timestamp, the number of non-confirmed -> confirmed transitions still present in `audit_logs`, and the administrator recipient ID. Repeated RPC calls for the same state transition therefore collide with the existing unique `serving_notifications_event_key_uidx` index and are ignored. A later decline/pending -> confirmed transition receives a different key.

The event token deliberately uses the existing audit trail instead of adding a schema column or new table. Audit and notification retention should remain aligned: if either retention policy changes, re-review the deduplication window.

Push registration accepts HTTPS endpoints only from these browser push services:

- `fcm.googleapis.com`
- `android.googleapis.com` (legacy Google endpoint)
- `updates.push.services.mozilla.com`
- `push.services.mozilla.com`
- `web.push.apple.com`
- One-label Microsoft WNS hosts below `notify.windows.com`

The Edge Function repeats the allowlist check before any outbound push request. This is intentional defense in depth. If a browser vendor changes its push-service host, update the SQL and Edge allowlists together and add tests before deployment.

Registration limits each account to ten devices. A same-endpoint re-registration by the same user updates the existing row. A shared-device account switch is allowed only when the caller presents the exact stored `p256dh` and `auth` key pair for that endpoint. Knowing the endpoint URL alone is insufficient. If a device remains registered to another account and the current browser cannot present the matching key pair, sign out from the prior account on that device and remove its subscription before switching.

The RPC no longer grants execution to `service_role`; it is an authenticated-browser operation. The push worker does not call this RPC.

## Dispatch worker concurrency

The hardened worker is based on the same queue-claim implementation as production Edge Function version 3 and the `develop` branch at the time of reconciliation. It retains:

- Atomic queue claiming through `gms_claim_serving_push_queue`.
- Per-row claim tokens and lease renewal.
- Endpoint delivery checkpoints and claim-safe retry/release.
- Bounded exponential retry delays.

The endpoint allowlist runs before any outbound push call. Unsupported legacy subscription rows are deleted with their errors checked; if cleanup fails, the claimed queue item follows the existing claim-safe retry path. The worker continues to use the queue RPCs rather than reverting to a direct unclaimed queue-table scan.

## Tests

### Edge endpoint allowlist and queue helpers

Run from the repository root with Deno installed:

```sh
deno test supabase/functions/dispatch-push/security_test.ts supabase/functions/_shared/leaseKeeper_test.ts supabase/functions/_shared/retryBackoff_test.ts
```

Coverage includes supported Google, Mozilla, Apple and Microsoft hosts; rejecting HTTP, localhost/private IPs, hostile suffix domains, userinfo, non-default ports, fragments, missing paths, whitespace and oversized URLs.

### Database regression script

`supabase/tests/notification_push_security.sql` is a rollback-only script for a dedicated staging project. It requires:

- at least one synthetic admin account;
- at least one synthetic servant account linked to an active servant row;
- a location row;
- two profile accounts without registered push subscriptions.

It tests repeat-call idempotency, a later confirmation cycle, cross-user notification rejection, endpoint host validation, malformed key rejection, user-agent bounds, cross-account endpoint takeover rejection, possession-based shared-device transfer, and the ten-device limit. Every inserted row and status change is rolled back.

Do not run this test against production. The rollback-only suite has been executed against the dedicated staging project using the synthetic admin and servant profiles. All assertions passed, and the temporary servant roster row, future schedule, assignment, notification rows and test push-subscription rows were rolled back. Post-test verification confirmed that no operational test rows remained.

## Deployment boundaries

Current state:

- The notification / push subscription hardening migration is applied to the dedicated staging project only.
- The availability timestamp search-path migration is prepared in this branch but has not been applied anywhere.
- The combined Edge Function source is prepared in this branch but has not been deployed to staging or production.
- No Vercel environment variables were changed.
- No VAPID or dispatch secrets were set or rotated.
- No cron jobs or additional extensions were installed.
- No pull request was opened, no branch was merged, and `main` was not changed.

Applying the follow-up migration, deploying the Edge Function, changing Vercel configuration, rotating secrets, or integrating branches requires separate review and explicit approval.
