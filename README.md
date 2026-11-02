# GMS Sound Scheduling System v5 update

## Included
- Renames the admin navigation section to **Servant Information**.
- Adds a data-driven summary dashboard: total/active servants, linked accounts, verification follow-up, church location distribution, CG category, domicile, CG status/leadership roles, incomplete profile indicators, pending serving requests and published service counts.
- Adds independently collapsible summary sections.
- Adds detailed servant records that expand inline, with search and filters for church, CG category and account linkage/status.
- Adds the branded GMS loading animation to the global authentication/profile/schedule loading states, including password recovery and password update loading.
- Keeps the existing Forgot Password email flow and the TypeScript fixes from the working v4 recovery patch.

## Apply the patch
Replace `src/App.tsx` and `src/style.css` in the existing repository with the files in this patch, then commit and deploy through Vercel.

## Database and security notes
This update uses the existing `servants`, `member_profiles`, `schedules`, and `serving_requests` tables and does not require a schema migration. Summary counts are calculated from rows visible to the current admin under existing Supabase RLS policies.

This frontend update does **not** by itself implement or certify server-side rate limiting, session policy, admin-only audit enforcement, or additional RLS hardening. Those must be reviewed and tested in Supabase separately; hiding a control in the UI is not an authorization boundary. No user accounts or records are deleted or recreated.

## Validation
The source files are packaged, but a full local `npm run build` could not be run in this environment because dependencies could not be installed. Run `npm install` and `npm run build` in the project before merging. Resolve any build errors before production deployment.
