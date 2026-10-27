-- BorrowNest Stage 2: private helper schema, profiles, and signup trigger.

-- Helpers live outside the API-exposed schemas so PostgREST never serves them.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- profiles: application identity. Email and credentials stay in auth.users.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null
    constraint profiles_full_name_length
      check (char_length(full_name) between 1 and 100)
    constraint profiles_full_name_trimmed
      check (full_name = pg_catalog.btrim(full_name)),
  role public.user_role not null default 'renter',
  account_status public.account_status not null default 'active',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

comment on table public.profiles is
  'One row per auth user. role and account_status are the only source of application authorization.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profile creation on signup. raw_user_meta_data is user-controlled, so it is
-- only ever used for an allowlisted account type and a normalized name.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_type text := new.raw_user_meta_data ->> 'account_type';
  safe_role public.user_role;
  safe_name text;
begin
  -- Only renter or provider can be requested. Anything else, including
  -- 'admin', silently becomes renter.
  safe_role := case
    when requested_type = 'provider' then 'provider'::public.user_role
    else 'renter'::public.user_role
  end;

  -- Strip control characters, collapse whitespace, trim, and bound length.
  safe_name := pg_catalog.regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    '[[:cntrl:]]', '', 'g'
  );
  safe_name := pg_catalog.btrim(pg_catalog.regexp_replace(safe_name, '\s+', ' ', 'g'));
  safe_name := pg_catalog.btrim(pg_catalog.left(safe_name, 100));
  if safe_name = '' then
    safe_name := 'BorrowNest member';
  end if;

  insert into public.profiles (id, full_name, role, account_status)
  values (new.id, safe_name, safe_role, 'active')
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
