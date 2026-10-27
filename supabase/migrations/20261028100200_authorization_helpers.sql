-- BorrowNest Stage 2: role and account checks used by RLS policies.
--
-- These are SECURITY DEFINER so policies on public.profiles can call them
-- without recursing into profiles RLS. Each one:
--   * lives in the non-exposed private schema,
--   * pins search_path to '' and qualifies every reference,
--   * identifies the caller only through auth.uid(),
--   * reads the current database row, so a suspension applies immediately
--     instead of waiting for a JWT to expire.

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.account_status = 'active'
  );
$$;

create or replace function private.has_active_role(required_role public.user_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.account_status = 'active'
      and p.role = required_role
  );
$$;

create or replace function private.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_active_role('admin'::public.user_role);
$$;

create or replace function private.is_active_provider()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_active_role('provider'::public.user_role);
$$;

-- Whether a given profile is an active provider (used by the public
-- catalogue to hide listings from suspended or demoted providers).
create or replace function private.is_eligible_provider(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = profile_id
      and p.role = 'provider'
      and p.account_status = 'active'
  );
$$;

revoke all on function private.is_active_user() from public, anon;
revoke all on function private.has_active_role(public.user_role) from public, anon;
revoke all on function private.is_active_admin() from public, anon;
revoke all on function private.is_active_provider() from public, anon;
revoke all on function private.is_eligible_provider(uuid) from public, anon, authenticated;

-- Policies are evaluated as the calling role, so authenticated needs to be
-- able to reach these helpers. The schema is not exposed through the API.
grant usage on schema private to authenticated;
grant execute on function private.is_active_user() to authenticated;
grant execute on function private.has_active_role(public.user_role) to authenticated;
grant execute on function private.is_active_admin() to authenticated;
grant execute on function private.is_active_provider() to authenticated;

-- ---------------------------------------------------------------------------
-- profiles access rules
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- Start from nothing: Supabase grants broad default privileges on new tables.
revoke all on table public.profiles from public, anon, authenticated;

-- Reading is row-filtered by RLS below. Updating is limited to full_name at
-- the column-privilege level, so role, account_status, id, and timestamps
-- cannot be written by any API user regardless of row policy.
grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

-- Users can always read their own row, including when suspended, so the app
-- can explain the account state. Nothing else is readable to them.
create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles: active admins read all"
  on public.profiles for select
  to authenticated
  using ((select private.is_active_admin()));

create policy "profiles: active users update own name"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()) and (select private.is_active_user()))
  with check (id = (select auth.uid()));

-- No INSERT or DELETE policies: profiles are created by the signup trigger
-- and removed only through auth.users deletion.
