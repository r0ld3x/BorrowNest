-- BorrowNest Stage 6: rental dates, pricing snapshots, and booking requests.
--
-- A request is created only through create_booking(). The database derives
-- the renter from auth.uid(), copies the provider, price and deposit from
-- the locked listing, computes days and totals itself, and freezes all of
-- it. Pending requests do not reserve dates; only confirmed/completed
-- bookings (Stage 7) block a range. Acceptance is not part of this stage.

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'rental_phase'
  ) then
    create type public.rental_phase as enum ('awaiting_handover', 'active', 'return_requested', 'returned');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  renter_id uuid not null references public.profiles (id) on delete restrict,
  provider_id uuid not null references public.profiles (id) on delete restrict,

  start_date date not null,
  end_date date not null,
  pickup_at timestamptz not null,
  return_at timestamptz not null,
  -- Inclusive daily billing: one calendar day is one billable day.
  rental_days integer generated always as (end_date - start_date + 1) stored,

  -- Snapshots copied from the listing at request time.
  price_per_day numeric(10, 2) not null constraint bookings_price_positive check (price_per_day > 0),
  deposit numeric(10, 2) not null constraint bookings_deposit_nonnegative check (deposit >= 0),
  rental_amount numeric(12, 2) generated always as ((end_date - start_date + 1) * price_per_day) stored,
  total_due numeric(12, 2) generated always as ((end_date - start_date + 1) * price_per_day + deposit) stored,

  note text not null default '' constraint bookings_note_length check (char_length(note) <= 500),
  status public.booking_status not null default 'pending',
  phase public.rental_phase not null default 'awaiting_handover',
  request_key uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),

  constraint bookings_dates_ordered check (end_date >= start_date),
  constraint bookings_max_length check (end_date - start_date + 1 <= 180),
  constraint bookings_return_after_pickup check (return_at > pickup_at),
  -- Exchange times fall on the booked dates in Gwalior time.
  constraint bookings_pickup_on_start check ((pickup_at at time zone 'Asia/Kolkata')::date = start_date),
  constraint bookings_return_on_end check ((return_at at time zone 'Asia/Kolkata')::date = end_date),
  constraint bookings_distinct_participants check (renter_id <> provider_id),
  -- The rental lifecycle only moves once a booking is confirmed.
  constraint bookings_phase_matches_status check (
    (status in ('pending', 'rejected', 'cancelled') and phase = 'awaiting_handover')
    or status = 'confirmed'
    or (status = 'completed' and phase = 'returned')
  ),
  -- One request per renter per idempotency key, enforced atomically.
  constraint bookings_request_key_unique unique (renter_id, request_key)
);

create index bookings_renter_idx on public.bookings (renter_id, created_at desc);
create index bookings_provider_idx on public.bookings (provider_id, status, start_date);
create index bookings_product_reserved_idx on public.bookings (product_id, start_date, end_date)
  where status in ('confirmed', 'completed');

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function private.set_updated_at();

-- Terms are immutable after creation, even for trusted functions.
create or replace function private.protect_booking_terms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.product_id, new.renter_id, new.provider_id, new.start_date, new.end_date,
      new.pickup_at, new.return_at, new.price_per_day, new.deposit, new.note,
      new.request_key, new.created_at)
     is distinct from
     (old.product_id, old.renter_id, old.provider_id, old.start_date, old.end_date,
      old.pickup_at, old.return_at, old.price_per_day, old.deposit, old.note,
      old.request_key, old.created_at) then
    raise exception 'BN:booking_terms_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_booking_terms() from public, anon, authenticated;

create trigger bookings_protect_terms
  before update on public.bookings
  for each row execute function private.protect_booking_terms();

-- The provider is always the listing's owner.
create or replace function private.check_booking_provider()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider_id is distinct from (select p.provider_id from public.products p where p.id = new.product_id) then
    raise exception 'BN:booking_provider_mismatch' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.check_booking_provider() from public, anon, authenticated;

create trigger bookings_check_provider
  before insert on public.bookings
  for each row execute function private.check_booking_provider();

-- ---------------------------------------------------------------------------
-- booking_events (append-only) and private pickup snapshots
-- ---------------------------------------------------------------------------
create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  actor_id uuid,
  event_type text not null constraint booking_events_type_allowed check (event_type in ('request_created')),
  previous_status public.booking_status,
  next_status public.booking_status,
  reason text constraint booking_events_reason_length check (char_length(reason) <= 500),
  created_at timestamptz not null default pg_catalog.now()
);
create index booking_events_booking_idx on public.booking_events (booking_id, created_at);

-- Filled atomically at acceptance (Stage 7). Never readable by a pending renter.
create table public.booking_pickup_snapshots (
  booking_id uuid primary key references public.bookings (id) on delete restrict,
  exact_address text not null constraint booking_pickup_address_length check (char_length(exact_address) between 5 and 500),
  pickup_instructions text not null default '' constraint booking_pickup_instructions_length check (char_length(pickup_instructions) <= 1000),
  created_at timestamptz not null default pg_catalog.now()
);

-- ---------------------------------------------------------------------------
-- Access: read-only through RLS, no client writes at all.
-- ---------------------------------------------------------------------------
alter table public.bookings enable row level security;
alter table public.booking_events enable row level security;
alter table public.booking_pickup_snapshots enable row level security;

revoke all on table public.bookings from public, anon, authenticated;
revoke all on table public.booking_events from public, anon, authenticated;
revoke all on table public.booking_pickup_snapshots from public, anon, authenticated;
grant select on table public.bookings to authenticated;
grant select on table public.booking_events to authenticated;
grant select on table public.booking_pickup_snapshots to authenticated;
grant select, insert, update, delete on table public.bookings to service_role;
grant select, insert, update, delete on table public.booking_events to service_role;
grant select, insert, update, delete on table public.booking_pickup_snapshots to service_role;

create policy "bookings: active renters read own"
  on public.bookings for select to authenticated
  using (renter_id = (select auth.uid()) and (select private.has_active_role('renter'::public.user_role)));

create policy "bookings: active providers read requests for their items"
  on public.bookings for select to authenticated
  using (provider_id = (select auth.uid()) and (select private.is_active_provider()));

create policy "bookings: active admins read all"
  on public.bookings for select to authenticated
  using ((select private.is_active_admin()));

-- Events follow their booking's visibility (the subquery is RLS-filtered).
create policy "booking_events: visible with their booking"
  on public.booking_events for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_events.booking_id));

-- Participant access to pickup snapshots arrives with confirmation (Stage 7).
create policy "booking_pickup_snapshots: active admins read"
  on public.booking_pickup_snapshots for select to authenticated
  using ((select private.is_active_admin()));

-- ---------------------------------------------------------------------------
-- create_booking
-- ---------------------------------------------------------------------------
create or replace function private.gwalior_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (pg_catalog.now() at time zone 'Asia/Kolkata')::date;
$$;
revoke all on function private.gwalior_today() from public, anon, authenticated;

create or replace function public.create_booking(
  p_product_id uuid,
  p_start_date date,
  p_end_date date,
  p_pickup_at timestamptz,
  p_return_at timestamptz,
  p_note text,
  p_request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  v_note text := private.clean_block(p_note);
  existing public.bookings;
  product public.products;
  today date := private.gwalior_today();
  new_id uuid;
begin
  if caller is null or not private.has_active_role('renter'::public.user_role) then
    raise exception 'BN:not_active_renter' using errcode = 'P0001';
  end if;
  if p_request_key is null then
    raise exception 'BN:invalid_request' using errcode = 'P0001';
  end if;

  -- Idempotent retry: same key + same request returns the original booking.
  select * into existing from public.bookings where renter_id = caller and request_key = p_request_key;
  if found then
    if (existing.product_id, existing.start_date, existing.end_date, existing.pickup_at, existing.return_at, existing.note)
       is not distinct from (p_product_id, p_start_date, p_end_date, p_pickup_at, p_return_at, v_note) then
      return existing.id;
    end if;
    raise exception 'BN:request_key_conflict' using errcode = 'P0001';
  end if;

  -- Dates and exchange times (all in Gwalior time).
  if p_start_date is null or p_end_date is null or p_pickup_at is null or p_return_at is null then
    raise exception 'BN:invalid_dates' using errcode = 'P0001';
  end if;
  if p_start_date < today + 1 then
    raise exception 'BN:start_too_soon' using errcode = 'P0001';
  end if;
  if p_start_date > today + 365 then
    raise exception 'BN:start_too_far' using errcode = 'P0001';
  end if;
  if p_end_date < p_start_date then
    raise exception 'BN:end_before_start' using errcode = 'P0001';
  end if;
  if p_end_date - p_start_date + 1 > 180 then
    raise exception 'BN:rental_too_long' using errcode = 'P0001';
  end if;
  if (p_pickup_at at time zone 'Asia/Kolkata')::date <> p_start_date then
    raise exception 'BN:pickup_not_on_start' using errcode = 'P0001';
  end if;
  if (p_return_at at time zone 'Asia/Kolkata')::date <> p_end_date then
    raise exception 'BN:return_not_on_end' using errcode = 'P0001';
  end if;
  if p_return_at <= p_pickup_at then
    raise exception 'BN:return_before_pickup' using errcode = 'P0001';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'BN:invalid_note' using errcode = 'P0001';
  end if;

  -- Lock the listing while copying its current terms.
  select * into product from public.products where id = p_product_id for update;
  if not found or product.listing_status <> 'published' or not private.is_eligible_provider(product.provider_id) then
    raise exception 'BN:listing_unavailable' using errcode = 'P0001';
  end if;

  -- Pending requests never block; confirmed and completed bookings do.
  if exists (
    select 1 from public.bookings b
    where b.product_id = product.id
      and b.status in ('confirmed', 'completed')
      and daterange(b.start_date, b.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
  ) then
    raise exception 'BN:dates_unavailable' using errcode = 'P0001';
  end if;

  -- Abuse limit: open requests per renter.
  if (select count(*) from public.bookings where renter_id = caller and status = 'pending') >= 20 then
    raise exception 'BN:too_many_requests' using errcode = 'P0001';
  end if;

  begin
    insert into public.bookings (
      product_id, renter_id, provider_id, start_date, end_date, pickup_at, return_at,
      price_per_day, deposit, note, request_key
    ) values (
      product.id, caller, product.provider_id, p_start_date, p_end_date, p_pickup_at, p_return_at,
      product.price_per_day, product.deposit, v_note, p_request_key
    )
    returning id into new_id;
  exception when unique_violation then
    -- A concurrent retry with the same key won the race: apply the same rule.
    select * into existing from public.bookings where renter_id = caller and request_key = p_request_key;
    if (existing.product_id, existing.start_date, existing.end_date, existing.pickup_at, existing.return_at, existing.note)
       is not distinct from (p_product_id, p_start_date, p_end_date, p_pickup_at, p_return_at, v_note) then
      return existing.id;
    end if;
    raise exception 'BN:request_key_conflict' using errcode = 'P0001';
  end;

  insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status)
  values (new_id, caller, 'request_created', null, 'pending');

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read functions: explicit columns, participants only.
-- ---------------------------------------------------------------------------

-- Booked dates only (no ids, renters, or counts), bounded to 400 days.
create or replace function public.product_blocked_dates(p_product_id uuid, p_from date, p_to date)
returns table (blocked_date date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := greatest(coalesce(p_from, private.gwalior_today()), private.gwalior_today());
  v_to date;
begin
  v_to := least(coalesce(p_to, v_from + 180), v_from + 400);
  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.listing_status = 'published' and private.is_eligible_provider(p.provider_id)
  ) then
    return;
  end if;
  return query
  select distinct d::date
  from public.bookings b,
       pg_catalog.generate_series(greatest(b.start_date, v_from), least(b.end_date, v_to), interval '1 day') d
  where b.product_id = p_product_id
    and b.status in ('confirmed', 'completed')
    and b.end_date >= v_from and b.start_date <= v_to
  order by 1;
end;
$$;

create or replace function public.renter_bookings(p_booking_id uuid, p_limit integer, p_offset integer)
returns table (
  id uuid, product_id uuid, product_title text, product_area text, product_landmark text, cover_path text,
  listed_by text, start_date date, end_date date, pickup_at timestamptz, return_at timestamptz,
  rental_days integer, price_per_day numeric, deposit numeric, rental_amount numeric, total_due numeric,
  note text, status public.booking_status, phase public.rental_phase, created_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  page_size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  page_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  if caller is null or not private.has_active_role('renter'::public.user_role) then
    raise exception 'BN:not_active_renter' using errcode = 'P0001';
  end if;
  return query
  select b.id, b.product_id, p.title, p.area, p.landmark,
         (select i.storage_path from public.product_images i where i.product_id = p.id order by i.sort_order limit 1),
         private.public_first_name(pr.full_name),
         b.start_date, b.end_date, b.pickup_at, b.return_at, b.rental_days,
         b.price_per_day, b.deposit, b.rental_amount, b.total_due, b.note, b.status, b.phase, b.created_at,
         count(*) over ()
  from public.bookings b
  join public.products p on p.id = b.product_id
  join public.profiles pr on pr.id = b.provider_id
  where b.renter_id = caller and (p_booking_id is null or b.id = p_booking_id)
  order by b.created_at desc, b.id
  limit page_size offset page_offset;
end;
$$;

create or replace function public.provider_booking_requests(
  p_status public.booking_status, p_booking_id uuid, p_limit integer, p_offset integer
)
returns table (
  id uuid, product_id uuid, product_title text, renter_name text,
  start_date date, end_date date, pickup_at timestamptz, return_at timestamptz,
  rental_days integer, price_per_day numeric, deposit numeric, rental_amount numeric, total_due numeric,
  note text, status public.booking_status, created_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  page_size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  page_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  if caller is null or not private.is_active_provider() then
    raise exception 'BN:not_active_provider' using errcode = 'P0001';
  end if;
  return query
  select b.id, b.product_id, p.title, private.public_first_name(r.full_name),
         b.start_date, b.end_date, b.pickup_at, b.return_at, b.rental_days,
         b.price_per_day, b.deposit, b.rental_amount, b.total_due, b.note, b.status, b.created_at,
         count(*) over ()
  from public.bookings b
  join public.products p on p.id = b.product_id
  join public.profiles r on r.id = b.renter_id
  where b.provider_id = caller
    and (p_status is null or b.status = p_status)
    and (p_booking_id is null or b.id = p_booking_id)
  order by b.start_date, b.created_at, b.id
  limit page_size offset page_offset;
end;
$$;

revoke all on function public.create_booking(uuid, date, date, timestamptz, timestamptz, text, uuid) from public, anon;
revoke all on function public.renter_bookings(uuid, integer, integer) from public, anon;
revoke all on function public.provider_booking_requests(public.booking_status, uuid, integer, integer) from public, anon;
revoke all on function public.product_blocked_dates(uuid, date, date) from public;
grant execute on function public.create_booking(uuid, date, date, timestamptz, timestamptz, text, uuid) to authenticated;
grant execute on function public.renter_bookings(uuid, integer, integer) to authenticated;
grant execute on function public.provider_booking_requests(public.booking_status, uuid, integer, integer) to authenticated;
grant execute on function public.product_blocked_dates(uuid, date, date) to anon, authenticated;
