-- Run only in the Supabase SQL Editor as the trusted project owner.
-- First create the Auth user in Supabase Dashboard > Authentication > Users > Add user.
-- Do NOT insert directly into auth.users.
-- Replace the email below with the exact administrator email.

update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('admin@example.com');

-- Verify the account and role:
select u.email, p.username, p.role
from auth.users u
join public.profiles p on p.id = u.id
where lower(u.email) = lower('admin@example.com');
