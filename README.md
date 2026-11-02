# GMS Sound Scheduling System — Workflow Enhancements

Based on the latest uploaded project ZIP.

## Included frontend changes
1. Servant Inbox shows pending and reviewed swap/replacement requests. Approved/rejected decisions have read/unread styling and a navigation badge.
2. Admin has a separate "Servant Requests" menu with a pending-request badge. Request review is removed from the schedule page.
3. Direct cross-date swap request: choose another published service on a different date and select an assigned servant. The app checks that each participant has no assignment at another church on the date they would receive.
4. Admin Scheduling Control Center summarizes incomplete FOH/Monitor coverage, pending requests, unconfirmed assignments and upcoming services. The existing schedule generator remains available.
5. Personal schedule keeps the logged-in servant's next assignment and upcoming assignments, now using the direct swap workflow.

## REQUIRED database migration
Run `supabase/migrations_20261105_workflow_enhancements.sql` in Supabase SQL Editor before deploying the frontend. It:
- Adds target schedule/assignment/servant columns to `serving_requests`.
- Creates `serving_request_reads` with row-level security for servant-owned request receipts.
- Adds `admin_execute_servant_swap(uuid)`, an admin-only atomic database function. It revalidates both published assignments and cross-church same-day conflicts at approval time, swaps the two servants, resets confirmation to pending, and marks the request approved in one transaction.

## Apply
1. Back up the Supabase database.
2. Run the migration SQL.
3. Replace `src/App.tsx` and `src/style.css`.
4. Run `npm install` if dependencies are not installed.
5. Run `npm run build`; deploy only if it succeeds.

## Validation
- ZIP integrity check passed.
- Global TypeScript parser reported no syntax diagnostics.
- A full project build could not be completed because dependency installation timed out in this environment; remaining `tsc` diagnostics are unresolved imports/types from missing React, lucide-react and project modules. Therefore this patch is not represented as a successful production build.
