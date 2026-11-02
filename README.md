# GMS Sound Scheduling System

A responsive church sound-team scheduling system for multiple GMS locations, built with React, TypeScript, Vite and Supabase.

## Confirmed operating model

- One central administrator manages every church location.
- Assignments are made manually. The app validates availability and conflicts but does not auto-assign people.
- Only administrators can publish schedules.
- Servants see only published services assigned to their own servant profile.
- Advanced serving statistics and audit history are admin-only.

## Main features

- Weekly and monthly calendar grouping with daily summaries and collapsible service details.
- Add any dated service, including weekday special services (Christmas, prayer meetings, conferences, etc.).
- Add future church locations and recurring Saturday/Sunday service templates.
- Bulk-generate 1, 2, 4, 8 or 12 weekends of draft service slots from active templates.
- Manual FOH, Monitor and optional Assistant assignments.
- Conflict checks: no same-day cross-location assignments and no overlapping same-location assignments.
- Availability management with an admin-set submission deadline, countdown banner and servant-side submission lock after the deadline.
- Draft/published schedule workflow and servant assignment confirmations.
- Servant replacement and swap requests, reviewed by the central administrator. Approval records the decision; the administrator makes the final manual assignment change.
- Admin-only serving statistics and workload fairness checker.
- Admin-only audit log for schedule and assignment changes.
- Servant view of personal published schedule and own availability.
- CSV export, servant directory, and responsive larger role labels.

## Existing project update (important)

For an existing Supabase project, do **not** rerun the full schema over your live database. Instead:

1. Open Supabase Dashboard → SQL Editor.
2. Run `supabase/migrations_20261103.sql` once.
3. Update the GitHub project files from this release.
4. Confirm your existing administrator profile still has `role = 'admin'`.
5. Deploy/redeploy the Vercel project.

The migration preserves existing schedules by marking them published. Newly created schedules default to draft.

For a brand-new Supabase project, run `supabase/schema.sql` once. It includes the base schema and the new enhancements. Do not additionally run the migration after running the complete schema file.

## Configure the frontend

Install Node.js 20 or newer, then:

```bash
npm install
```

Copy `.env.example` to `.env` and set:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Then run:

```bash
npm run dev
```

Build check:

```bash
npm run build
```

Never put a Supabase `service_role` key in the frontend or GitHub repository. Keep `.env` out of Git.

## First administrator

After signing up, promote the central administrator in Supabase SQL Editor:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'YOUR_EMAIL');
```

## Link a servant login to the servant directory

Each servant's login must be linked to their directory record for personal schedules, availability, confirmations and requests:

```sql
update public.servants
set auth_user_id = (
  select id from auth.users where email = 'servant@example.com'
)
where full_name = 'Servant Full Name';
```

Ensure each email maps to exactly one active servant record.

## Workflow

1. Admin adds recurring service templates and/or special dated services.
2. Admin bulk-generates future weekend service slots. Generated slots are drafts.
3. Admin manually assigns FOH, Monitor and optional Assistant.
4. The app blocks unavailable servants, cross-location same-day conflicts and overlapping services at the same location.
5. Admin publishes each completed service. Servants can then see and confirm it.
6. Servants submit replacement or swap requests; admin reviews them and manually updates the schedule.
7. Admin monitors statistics and audit history.

## WhatsApp

This release keeps WhatsApp notifications as a manual/click-to-send workflow recommendation. Automatic WhatsApp messages require WhatsApp Business Platform/API setup and may incur message/provider charges; no paid API is configured in this project.
