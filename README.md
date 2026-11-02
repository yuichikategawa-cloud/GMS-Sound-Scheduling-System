# GMS Serving Management System (Version 2)

A responsive church serving schedule application for:
- GMS Alam Sutera
- GMS BSD
- GMS Karawaci

Built with React + TypeScript + Vite and Supabase (PostgreSQL + Auth).

## Features

- Shared database: schedule updates are visible to all signed-in users.
- Email/password authentication.
- Admin and servant roles.
- Schedule cards with date, location, service name, time, FOH, Monitor and optional Assistant.
- Search by servant name across all roles.
- Filters for location, service, date range.
- Generate all recurring Saturday and Sunday service slots for a selected weekend.
- Servant directory; admins can add and deactivate servants.
- CSV export.
- Row Level Security policies in the database.

## 1. Create Supabase project

1. Go to https://supabase.com and create a project.
2. Open **SQL Editor** in your Supabase project.
3. Open `supabase/schema.sql` from this project, copy all its contents, and run it.
4. In **Project Settings > API** (or API Keys), copy the Project URL and the publishable/anon key.

## 2. Configure the app

Install Node.js 20 or newer.

In this project folder:

```bash
npm install
```

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Do not put the Supabase `service_role` or secret key in `.env` or frontend code.

Start the app:

```bash
npm run dev
```

Open the local URL printed by Vite (normally http://localhost:5173).

## 3. Create the first admin

1. In the app, choose **Create your account** and register using your email.
2. Confirm the email if email confirmation is enabled in Supabase.
3. Sign in once, so the `profiles` row is created.
4. In Supabase **SQL Editor**, run this statement, replacing the email:

```sql
update public.profiles
set role = 'admin'
where id = (
  select id from auth.users where email = 'YOUR_EMAIL'
);
```

5. Sign out and sign in again. The Admin access label and admin controls should appear.

All other accounts default to the `servant` role. Promote additional administrators only by running the same SQL update for their email.

## 4. Add servants and schedules

1. As admin, open **Servant directory** and add the church's serving team names.
2. Open **Schedule** and choose **Generate weekend**.
3. Pick a Saturday. The app generates the service slots for that Saturday and the following Sunday across all locations.
4. Edit each service card and assign FOH, Monitor and optional Assistant.
5. Changes are stored in Supabase and shared with all authenticated users.

The generator does not overwrite existing service slots or assignments.

## 5. Deploy to Vercel

1. Push this project to a private or public GitHub repository.
2. In https://vercel.com, import the repository.
3. Add these environment variables in Vercel Project Settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. Vercel detects Vite automatically.
5. In Supabase **Authentication > URL Configuration**, add your deployed Vercel URL to **Site URL** and **Redirect URLs**.

## Database design

- `profiles`: authenticated users and access role (`admin` or `servant`).
- `locations`: the three GMS locations.
- `servants`: central servant directory.
- `service_templates`: recurring Saturday/Sunday shift definitions.
- `schedules`: actual dated service slots.
- `assignments`: one servant per role per service.

The `assignments` table has unique constraints to prevent assigning the same role twice or assigning one person to two roles in the same service.

## Notes / production checklist

- Users must sign in to view the schedule. This starter intentionally does not expose the schedule publicly.
- Admin-only write permissions are enforced by Supabase Row Level Security, not just by hiding buttons in the UI.
- The app uses the Supabase publishable/anon key in the browser; RLS is essential. Never use a service-role key in frontend code.
- The initial version does not send email/WhatsApp notifications.
- For a production church deployment, enable email confirmation, use strong passwords, restrict who can sign up if desired, and appoint at least two trusted admins.
- Current time/date display follows the browser's local timezone. Store dates as `date` and service times as `time` in Postgres.


## Daily overview

The Schedule tab includes a daily summary grouped by service date and church location. It shows each service time, FOH/Monitor/Assistant assignments, and required-role coverage (FOH and Monitor). The summary follows the active schedule filters.

## Updates in the November 2026 dashboard build

- Daily overview and service details are expandable/collapsible.
- FOH, Monitor and Assistant labels and servant names use larger, higher-contrast text.
- Admin navigation includes Availability and Statistics.
- Servants can submit their own availability once their login is linked to their servant directory record; admins can manage all records. Statuses: Available, Unavailable, Prefer not to serve, with optional notes.
- Statistics summarize assignments by servant, role and church location, following the active schedule filters.
- Cross-location same-day double-booking is checked in the UI and enforced by a Supabase database trigger.

### Existing Supabase project: apply the migration

If you already ran the original `supabase/schema.sql`, run `supabase/migrations_20261102.sql` once in Supabase Dashboard → SQL Editor. This creates the availability table and its access policies and installs the database-level assignment conflict guard. Do not rerun the original schema just to get these updates.

### Fresh Supabase project

For a new project, run the updated complete `supabase/schema.sql` as usual. It now includes the availability and conflict-protection setup.

### Link a servant login for self-service availability

Each servant can manage only their own availability after an administrator links their existing Supabase login to their servant directory record. Run this SQL for each person, replacing the email and exact servant name:

```sql
update public.servants
set auth_user_id = (select id from auth.users where email = 'servant@example.com')
where full_name = 'Servant Full Name';
```

Make sure the email exists in Supabase Authentication → Users and that the servant name matches exactly. Admins can manage availability for everyone; linked servants can create, update and delete only their own records.
