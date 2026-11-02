# GMS Sound Scheduling System v4 — Member Access & UI Patch

## Files
- Replace `src/App.tsx`
- Replace `src/style.css`

## Changes
- Admin accounts no longer see or need to complete the servant "My profile" form.
- Admin member overview now includes Team Leader, Coach, CG Leader and leader phone numbers.
- Members can request a password reset using their registered email and set a new password from the recovery link.
- All servants can see all published schedules across locations (not drafts), to coordinate swaps.
- Servant directory marks linked login accounts vs unlinked directory-only records.
- Search field and bulk-generation controls use responsive layouts to avoid overlap on mobile and narrow screens.

## Important
No database migration is required. The existing RLS policies in the v4 schema already allow authenticated users to read published schedules and their assignments. If the live project has older/custom RLS policies, verify those policies before rollout.

After replacing files, run:
`npm install`
`npm run build`

Test password recovery with a real member email. Configure the Supabase Auth Site URL and Redirect URLs to include your deployed Vercel domain.
