# Push Queue Dispatcher — Verification and Deployment Gate

## Production database state

The following migration is already applied in the connected production database:

`20261104110028_gms_push_queue_atomic_claims_and_retry_leases`

It adds claim tokens, claim/lease timestamps, retry eligibility, a partial pending-row index, and the `gms_claim_serving_push_queue(integer, integer)` RPC. The claim RPC returns at most five rows and uses `FOR UPDATE SKIP LOCKED`. Only `service_role` can execute it.

The current corrective branch adds a **separate, not-yet-applied** migration:

`20261104111500_gms_push_queue_claim_renewal_and_checkpoint_safe_retry`

It introduces three service-role-only RPCs:

- `gms_renew_serving_push_queue_claim(uuid, uuid, integer)` extends a lease only when the token matches and the current lease has not expired.
- `gms_checkpoint_serving_push_queue_endpoint(uuid, uuid, text)` records one endpoint using the database clock, only while the matching claim is still live. It avoids duplicate endpoint entries.
- `gms_release_serving_push_queue_claim(uuid, uuid, integer, integer, text, boolean)` completes or schedules a retry only for the current, unexpired claim. It intentionally does not write `delivered_endpoints`, so a stale in-memory queue snapshot cannot replace committed checkpoint progress.

The corrective migration has **not** been applied to production. It must be applied before deploying the corresponding Edge Function code.

The cron job remains active every minute. Its pg_net HTTP timeout is 120 seconds. The currently deployed Edge Function remains version 2 until separate deployment approval.

## Worker safeguards in the corrective branch

- Claims up to five queue rows per invocation.
- Starts a 180-second claim lease for each active item.
- Renews the active item's lease every 45 seconds and immediately before each external push send.
- Stops processing when lease renewal fails or the claim token is no longer valid.
- Checkpoints each delivered endpoint through a database RPC that checks the claim token and database-side lease expiry.
- Uses token-checked database RPCs to release for retry or mark complete.
- Retry delay doubles from 30 seconds and caps at 15 minutes.
- Stops retrying after eight attempts and records the final failure.
- Preserves the in-app Inbox notification regardless of push delivery preference or result.
- Removes permanently expired subscriptions when the provider returns HTTP 404/410.

## Automated checks

Run the following in CI:

```sh
deno check --config supabase/functions/dispatch-push/deno.json \
  supabase/functions/dispatch-push/index.ts

deno test --config supabase/functions/dispatch-push/deno.json \
  supabase/functions/_shared/leaseKeeper_test.ts \
  supabase/functions/_shared/retryBackoff_test.ts

npm ci
npm run build
npm test
```

The Deno tests cover periodic lease renewal, explicit renewal, lost-lease fail-closed behavior, overlapping renewal calls, invalid heartbeat intervals, retry backoff, and retry-delay caps. The Deno typecheck covers the actual dispatcher entrypoint and its imports.

These automated checks do not replace a full database/worker integration test.

## Mandatory staging integration checks before production deployment

Use an isolated staging Supabase project with disposable test users, notifications, subscriptions, and queue rows. Do not run concurrent-claim or synthetic delivery tests against production.

1. Create at least two disposable notification rows and allow the existing insert trigger to enqueue them.
2. Invoke `gms_claim_serving_push_queue(5, 180)` concurrently from two independent database sessions. Confirm no notification is returned to both sessions.
3. Confirm returned claim tokens match their stored rows and differ between claimed rows.
4. Confirm an unexpired claim cannot be claimed by another worker.
5. Confirm a lease can be renewed while it is live.
6. Confirm a lease cannot be renewed after expiry, including when no other worker has reclaimed it yet.
7. Expire a lease and confirm a new worker can claim it with a different token.
8. Confirm the old token cannot renew, checkpoint, retry, or complete the row after a new claim.
9. Confirm a valid token can checkpoint an endpoint, and that checkpointing the same endpoint twice does not duplicate it.
10. Checkpoint one endpoint, then release the claim for retry. Confirm the saved endpoint remains in `delivered_endpoints`.
11. Confirm the retry RPC rejects stale tokens and expired leases without changing the row.
12. Confirm a retry row cannot be claimed before `next_attempt_at`, and becomes claimable after the delay.
13. Confirm eight failed attempts terminate processing and retain the final error.
14. Confirm the notification remains readable in the in-app Inbox when push is disabled or delivery fails.
15. Confirm HTTP 404/410 subscriptions are removed, while transient provider errors remain retryable.
16. Simulate a slow provider response longer than 45 seconds. Confirm heartbeat renewal keeps the claim live and a second worker cannot claim the same row while the first worker is active.

### Useful staging verification queries

Inspect the claim and retry RPC permissions:

```sql
SELECT
  p.oid::regprocedure AS function_signature,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'gms_claim_serving_push_queue',
    'gms_renew_serving_push_queue_claim',
    'gms_checkpoint_serving_push_queue_endpoint',
    'gms_release_serving_push_queue_claim'
  )
ORDER BY p.proname;
```

Inspect disposable queue rows after each test:

```sql
SELECT
  notification_id,
  attempts,
  delivered_endpoints,
  claim_token,
  claimed_at,
  lease_expires_at,
  next_attempt_at,
  processed_at,
  last_error
FROM public.serving_push_queue
WHERE notification_id = '<disposable-notification-uuid>'::uuid;
```

The concurrency test must use two genuinely independent database sessions. Running the two calls sequentially in one SQL Editor session is not a concurrency test.

## Current verification limitations

The connected Supabase project is production and there is no separate staging project available through the current connection. The production queue has no pending rows and there are no registered browser push subscriptions. Therefore:

- No real push has been sent as part of this work.
- No production queue rows were created for testing.
- No concurrency/lease-expiry tests have been run against live data.
- The staging integration checks above remain a deployment gate.

## Delivery semantics and residual risk

Push-provider acceptance and a PostgreSQL checkpoint cannot be committed in one atomic transaction. If a provider accepts a push and the worker crashes before the database checkpoint succeeds, a subsequent retry may send a duplicate. Leases, token fencing, heartbeats, and per-endpoint checkpoints substantially reduce duplicates; they do not provide exactly-once delivery.
