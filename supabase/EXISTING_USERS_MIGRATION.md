# Existing v3 accounts: one-time username setup

The v4 login form uses usernames. Existing Supabase Auth users from v3 do not automatically have a username or the full member profile because those details were not collected in v3.

Before deploying the new login screen, the central administrator should assign each existing user a unique username in Supabase SQL Editor. Example (replace the values):

```sql
update public.profiles
set username = 'centraladmin'
where id = (
  select id from auth.users where lower(email) = lower('admin@example.com')
);
```

Repeat for each existing account, using a unique username. Usernames must be 3–40 characters and use letters, numbers, periods, underscores or hyphens. Do not publish this mapping or expose it in the client.

Existing v3 users will need their member details collected and entered into `public.member_profiles` by an authorized administrator before the My Profile page is available. New v4 registrations create the profile automatically. Existing users should continue to use the same password; after their username is assigned, they sign in with the username instead of email.

Do not change or reset passwords in SQL. Supabase Auth owns password storage and verification.
