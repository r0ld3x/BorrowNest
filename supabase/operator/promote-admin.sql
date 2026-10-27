-- ===========================================================================
-- OPERATOR ONLY. NOT A MIGRATION. DO NOT RUN FROM THE APPLICATION.
-- ===========================================================================
-- Promotes ONE existing, email-confirmed user to admin, identified by UUID.
--
-- 1. The person signs up normally and confirms their email.
-- 2. Find their UUID in Supabase Dashboard -> Authentication -> Users.
-- 3. Replace the placeholder below, then run this in the SQL Editor
--    (which runs with owner privileges; the API cannot change roles).
-- 4. Check that exactly one row is returned.
--
-- The application has no admin signup, no promotion endpoint, and never
-- promotes based on an email address or signup metadata.

update public.profiles as p
set role = 'admin'
from auth.users as u
where p.id = u.id
  and u.id = 'REPLACE-WITH-USER-UUID'::uuid
  and u.email_confirmed_at is not null
  and p.account_status = 'active'
returning p.id, p.full_name, p.role, p.account_status;
