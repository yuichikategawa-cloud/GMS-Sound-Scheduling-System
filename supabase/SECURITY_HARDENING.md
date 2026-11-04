# Notification and Push Subscription Hardening

## Scope

This change follows the staging-only authorization review. It hardens two authenticated notification entry points and the push delivery worker:

- `notify_admin_assignment_confirmation(uuid)` deduplicates notifications per real confirmation transition.
- `register_serving_push_subscription(...)` validates browser subscription inputs, serializes concurrent registration, limits device registrations, and prevents endpoint takeover by a caller who only knows another account's endpoint URL.
- `dispatch-push` sends only to a fixed allowlist of browser push-service origins, including for pre-existing rows.
- The app's disable action deletes only the signed-in user's matching row and checks the delete result before unsubscribing the browser endpoint.

This does not change administrator authorization, servant assignment rules, schedule publication, notification preferences, or the manual assignment workflow.

## Database migration

Apply only after separate approval:

- `supabase/migrations/20261104170500_gms_notification_push_subscription_hardening.sql`

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

## Tests

### Edge endpoint allowlist

Run from the repository root with Deno installed:

```sh
deno test supabase/functions/dispatch-push/security_test.ts
```

Coverage includes supported Google, Mozilla, Apple and Microsoft hosts; rejecting HTTP, localhost/private IPs, hostile suffix domains, userinfo, non-default ports, fragments, missing paths, whitespace and oversized URLs.

### Database regression script

`supabase/tests/notification_push_security.sql` is a rollback-only script for a dedicated staging project. It requires:

- at least one synthetic admin account;
- at least one synthetic servant account linked to an active servant row;
- a location row;
- two profile accounts without registered push subscriptions.

It tests repeat-call idempotency, a later confirmation cycle, cross-user notification rejection, endpoint host validation, malformed key rejection, user-agent bounds, cross-account endpoint takeover rejection, possession-based shared-device transfer, and the ten-device limit. Every inserted row and status change is rolled back.

Do not run this test against production. It has not been run by this branch preparation, because applying SQL or mutating even rollback-only test transactions in Supabase staging was outside the approved scope.

## Deployment boundaries

Preparing this branch does not:

- apply the migration to staging or production;
- deploy or update an Edge Function;
- configure Vercel environment variables;
- set or rotate VAPID / dispatch secrets;
- enable `pg_cron`, `pg_net`, or scheduled jobs;
- create a pull request, merge, or push to `main`.

Those actions require separate review and explicit approval.
