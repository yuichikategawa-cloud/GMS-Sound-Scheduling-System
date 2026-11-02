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

## v4 update: username login and member profiles

This release adds username-based sign-in, member registration/profile details, a self-service profile page, a three-month profile verification reminder, past-schedule hiding, and admin-only schedule-history CSV export.

### Existing Supabase project upgrade
1. Run `supabase/migrations_20261104.sql` once in Supabase SQL Editor, after the v3 migrations.
2. Deploy the username login Edge Function from the project root:
   ```bash
   supabase functions deploy username-login --no-verify-jwt
   ```
3. Ensure the function has the standard Supabase secrets configured. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are available as Edge Function environment variables in standard Supabase projects. Never put the service-role key in the frontend or GitHub.
4. Keep Supabase Auth email confirmation enabled if you want registered email ownership verified. Users enter their username at login, but the account's registered email is still used internally by Supabase Auth.
5. The first administrator role remains managed through the existing secure SQL promotion process.

### Username login security
The browser sends the username and password to the `username-login` Edge Function over HTTPS. The function performs a private username lookup with the server-only service-role key, then asks Supabase Auth to verify the password. It returns only the normal short-lived Supabase session tokens. Passwords are never stored in the application database. Supabase Auth hashes passwords; passwords should be hashed rather than reversibly encrypted. The service-role key must remain server-side. The function returns the same error for unknown usernames and incorrect passwords to reduce account enumeration.

Deploy the function with `--no-verify-jwt` because sign-in happens before a user session exists. Protect this public endpoint with Supabase Auth rate limits and, for larger deployments, add an IP/device rate limiter or CAPTCHA before production.

### Member profile access
`member_profiles` uses Row Level Security: members can read/update only their own profile; administrators can read the member directory. Registration metadata is copied by the Auth trigger. New registrations also create/link their servant directory record to the Auth user automatically. Existing accounts created before v4 need their username and member profile populated by an admin-assisted migration or profile-completion process.

### Notes
- NIJ means Nomor Induk Jemaat and is unique in the member profile table.
- CG days are stored as an array, allowing multiple selections.
- Leader phone numbers are stored as an array; at least one is required.
- Past schedules are hidden from the normal schedule view, not deleted. Admins can download past schedule history as CSV.
- The three-month reminder is shown to the signed-in member when their last verification is older than 90 days.

For the one-time username assignment and profile onboarding steps for accounts that existed before v4, see `supabase/EXISTING_USERS_MIGRATION.md`. Assign usernames before switching users to the username login screen.


## Administrator account provisioning (updated)

Public registration is **servant-only**. The website no longer displays an administrator registration option. Every account created through the public sign-up form receives the default `servant` role.

To create an administrator, use the Supabase project owner workflow instead:

1. In Supabase Dashboard, open **Authentication → Users → Add user**. Create the account with the administrator's email and a temporary/initial password. This creates the Auth identity using Supabase's supported mechanism; do not insert rows directly into `auth.users` with SQL.
2. Open **SQL Editor** and run the following, replacing the email address.

   ```sql
   update public.profiles p
   set role = 'admin'
   from auth.users u
   where p.id = u.id
     and lower(u.email) = lower('admin@example.com');
   ```

3. Verify the role:

   ```sql
   select u.email, p.username, p.role
   from auth.users u
   join public.profiles p on p.id = u.id
   where lower(u.email) = lower('admin@example.com');
   ```

4. Have the administrator sign in through the normal username login. Ensure the account has a unique username in `public.profiles`; assign one through the authorized admin workflow/SQL if it was not populated during account provisioning.

**Important:** Do not create Auth users by manually inserting into `auth.users`; Supabase manages internal password hashes, identity records and required metadata. Do not expose the service-role key in the browser or commit it to GitHub. Only trusted project owners should be able to promote accounts.

## Loading experience

Loading states now use an animated audio equalizer branded for GMS Sound Scheduling System. Page content also uses a short fade/slide transition. Reduced-motion preferences are respected.
