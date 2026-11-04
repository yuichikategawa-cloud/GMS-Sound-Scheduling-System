# Push Queue Dispatch — Verification Plan

## Production database migration already applied

Migration `20261104110028_gms_push_queue_atomic_claims_and_retry_leases` adds:
- Per-row claim tokens and timestamps.
- A 180-second lease and retry eligibility timestamp.
- A partial index for pending, eligible rows.
- `gms_claim_serving_push_queue(integer, integer)`, which claims up to five rows using `FOR UPDATE SKIP LOCKED`.
- Execute permission for `service_role` only.

The existing cron job remains active every minute. Its pg_net HTTP timeout is 120 seconds. The deployed Edge Function has **not** been changed by this branch.

## Automated checks

- `npm run build`
- `npm test`

The unit test covers the retry delay schedule: 30, 60, 120, 240, 480, 900 seconds, capped at 900 seconds.

## Required staging integration checks before production Edge Function deployment

1. Create at least two disposable notification rows that enqueue queue rows.
2. Invoke `gms_claim_serving_push_queue(5, 180)` concurrently from two independent database sessions.
3. Confirm each queue notification is returned to at most one session and no notification is returned to both.
4. Confirm claim tokens differ for different rows and that the returned claim token matches the persisted row token.
5. Confirm a row with an unexpired lease is not claimable.
6. Expire a lease in the disposable staging database and confirm the row becomes claimable again.
7. Confirm a stale token cannot checkpoint, retry, or complete a row after a new worker has claimed it.
8. Confirm a valid token can checkpoint each delivered endpoint and complete the row.
9. Confirm retry scheduling excludes a row until `next_attempt_at`, then permits it to be claimed.
10. Confirm attempts stop at eight and terminal failures are retained in `last_error`.
11. Confirm the notification remains in the in-app Inbox regardless of push preference or delivery result.
12. Confirm expired browser subscriptions (HTTP 404/410) are removed and do not retry indefinitely.

Do not run destructive concurrency tests against production. The production queue currently has no pending rows and no registered push subscriptions, so real delivery cannot be verified there.

## Delivery semantics

Push provider acceptance and a PostgreSQL checkpoint cannot be one atomic transaction. If the provider accepts a push and the worker crashes before the endpoint checkpoint commits, a retry can send a duplicate. The claim lease prevents concurrent workers from normally processing the same row; the endpoint checkpoint minimizes duplicate delivery after successful checkpoints but cannot guarantee exactly-once delivery.
