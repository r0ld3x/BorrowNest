-- BorrowNest Stage 2: enum types.
-- Created only when absent so re-running against an existing database never
-- recreates (and never drops) a type that already holds data.

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'user_role'
  ) then
    create type public.user_role as enum ('renter', 'provider', 'admin');
  end if;

  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'account_status'
  ) then
    create type public.account_status as enum ('active', 'suspended');
  end if;

  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'listing_status'
  ) then
    create type public.listing_status as enum (
      'draft', 'pending_review', 'published', 'paused', 'rejected', 'archived'
    );
  end if;

  -- Reserved for the booking workflow in a later stage. No tables use it yet.
  if not exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'booking_status'
  ) then
    create type public.booking_status as enum (
      'pending', 'confirmed', 'rejected', 'cancelled', 'completed'
    );
  end if;
end
$$;
