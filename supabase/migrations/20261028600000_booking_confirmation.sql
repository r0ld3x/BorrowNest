-- BorrowNest Stage 7: provider confirmation and atomic reservations.
--
-- Confirming reserves the dates. The exclusion constraint below makes two
-- overlapping confirmed/completed bookings for one item impossible, even if
-- two confirmations race; the functions also lock the product row first
-- (product, then booking, everywhere) so racing calls queue rather than
-- deadlock, and the loser gets a clear "dates were just reserved" error.

create extension if not exists btree_gist with schema extensions;

alter table public.bookings
  add constraint no_overlapping_reserved_bookings
  exclude using gist (
    product_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
  where (status in ('confirmed'::public.booking_status, 'completed'::public.booking_status));

-- New event types and audit targets.
alter table public.booking_events drop constraint booking_events_type_allowed;
alter table public.booking_events add constraint booking_events_type_allowed check (event_type in (
  'request_created', 'request_confirmed', 'request_rejected', 'request_cancelled', 'admin_cancelled'
));

alter table public.admin_audit_logs drop constraint admin_audit_action_allowed;
alter table public.admin_audit_logs add constraint admin_audit_action_allowed check (action in (
  'listing.approve', 'listing.reject', 'listing.edit', 'account.suspend', 'account.restore', 'booking.cancel'
));
alter table public.admin_audit_logs drop constraint admin_audit_target_type_allowed;
alter table public.admin_audit_logs add constraint admin_audit_target_type_allowed check (target_type in ('product', 'profile', 'booking'));

-- ---------------------------------------------------------------------------
-- Pickup snapshot access
-- ---------------------------------------------------------------------------
-- The renter sees the copied address only for a confirmed booking, or for a
-- completed one for 30 days after it ended (to settle anything left over).
-- Never for pending, rejected, or cancelled requests. The provider of the
-- booking (active) and active admins can read it too. Dispute access is
-- added in Stage 10.
create policy "booking_pickup_snapshots: participants of confirmed bookings"
  on public.booking_pickup_snapshots for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = booking_pickup_snapshots.booking_id
      and (
        (b.renter_id = (select auth.uid())
          and (select private.has_active_role('renter'::public.user_role))
          and (b.status = 'confirmed'
               or (b.status = 'completed' and b.end_date >= private.gwalior_today() - 30)))
        or (b.provider_id = (select auth.uid()) and (select private.is_active_provider()))
      )
  ));
grant execute on function private.gwalior_today() to authenticated;

-- ---------------------------------------------------------------------------
-- Participant transitions
-- ---------------------------------------------------------------------------
create or replace function public.transition_booking(p_booking_id uuid, p_action text, p_reason text)
returns public.booking_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  v_product_id uuid;
  product public.products;
  booking public.bookings;
  v_reason text := nullif(private.clean_block(p_reason), '');
  target public.booking_status;
  pickup public.product_pickup_details;
begin
  if p_action is null or p_action not in ('confirm', 'reject', 'cancel') then
    raise exception 'BN:invalid_action' using errcode = 'P0001';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'BN:reason_too_long' using errcode = 'P0001';
  end if;
  target := case p_action when 'confirm' then 'confirmed' when 'reject' then 'rejected' else 'cancelled' end;

  -- product_id never changes, so it is safe to read before locking.
  select b.product_id into v_product_id from public.bookings b where b.id = p_booking_id;
  if v_product_id is null then
    raise exception 'BN:booking_not_found' using errcode = 'P0001';
  end if;

  -- Lock order: product, then booking.
  select * into product from public.products where id = v_product_id for update;
  select * into booking from public.bookings where id = p_booking_id for update;

  -- Who may act. Others get the same answer as a missing booking.
  if p_action in ('confirm', 'reject') then
    if booking.provider_id is distinct from caller then
      raise exception 'BN:booking_not_found' using errcode = 'P0001';
    end if;
    if not private.is_active_provider() then
      raise exception 'BN:not_active_provider' using errcode = 'P0001';
    end if;
  else
    if booking.renter_id is distinct from caller then
      raise exception 'BN:booking_not_found' using errcode = 'P0001';
    end if;
    if not private.has_active_role('renter'::public.user_role) then
      raise exception 'BN:not_active_renter' using errcode = 'P0001';
    end if;
  end if;

  -- Repeating a transition that already happened is a no-op (no new event).
  if booking.status = target then
    return booking.status;
  end if;
  if booking.status <> 'pending' then
    raise exception 'BN:booking_not_pending' using errcode = 'P0001';
  end if;

  if p_action = 'confirm' then
    if product.listing_status <> 'published' or not private.is_eligible_provider(product.provider_id) then
      raise exception 'BN:listing_unavailable' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.profiles r
      where r.id = booking.renter_id and r.role = 'renter' and r.account_status = 'active'
    ) then
      raise exception 'BN:renter_inactive' using errcode = 'P0001';
    end if;
    if booking.pickup_at <= pg_catalog.now() then
      raise exception 'BN:pickup_expired' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.bookings other
      where other.product_id = booking.product_id and other.id <> booking.id
        and other.status in ('confirmed', 'completed')
        and daterange(other.start_date, other.end_date, '[]') && daterange(booking.start_date, booking.end_date, '[]')
    ) then
      raise exception 'BN:dates_unavailable' using errcode = 'P0001';
    end if;
    select * into pickup from public.product_pickup_details where product_id = product.id;
    if not found then
      raise exception 'BN:missing_pickup_details' using errcode = 'P0001';
    end if;

    begin
      -- Price and deposit stay the request's snapshot: nothing is repriced.
      update public.bookings set status = 'confirmed' where id = booking.id;
    exception when exclusion_violation then
      -- Backstop for any path that skipped the product lock.
      raise exception 'BN:dates_unavailable' using errcode = 'P0001';
    end;

    insert into public.booking_pickup_snapshots (booking_id, exact_address, pickup_instructions)
    values (booking.id, pickup.exact_address, pickup.pickup_instructions);
  else
    update public.bookings set status = target where id = booking.id;
  end if;

  insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status, reason)
  values (booking.id, caller,
          case p_action when 'confirm' then 'request_confirmed' when 'reject' then 'request_rejected' else 'request_cancelled' end,
          'pending', target, v_reason);

  return target;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin support cancellation (audited, before handover only)
-- ---------------------------------------------------------------------------
create or replace function public.admin_cancel_booking(p_booking_id uuid, p_reason text, p_settlement_note text)
returns public.booking_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_active_admin();
  v_product_id uuid;
  booking public.bookings;
  v_reason text := private.require_reason(p_reason, 10);
  v_settlement text := coalesce(nullif(private.clean_block(p_settlement_note), ''), 'None recorded');
begin
  if char_length(v_settlement) > 500 then
    raise exception 'BN:settlement_note_too_long' using errcode = 'P0001';
  end if;

  select b.product_id into v_product_id from public.bookings b where b.id = p_booking_id;
  if v_product_id is null then
    raise exception 'BN:booking_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.products where id = v_product_id for update;
  select * into booking from public.bookings where id = p_booking_id for update;

  if booking.status = 'cancelled' then
    return booking.status;
  end if;
  if booking.status not in ('pending', 'confirmed') then
    raise exception 'BN:booking_not_cancellable' using errcode = 'P0001';
  end if;
  -- Once the item has been handed over, the return workflow must be used.
  if booking.phase <> 'awaiting_handover' then
    raise exception 'BN:rental_in_progress' using errcode = 'P0001';
  end if;

  update public.bookings set status = 'cancelled' where id = booking.id;

  insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status, reason)
  values (booking.id, caller, 'admin_cancelled', booking.status, 'cancelled',
          pg_catalog.left('Admin support: ' || v_reason || ' · Settlement: ' || v_settlement, 500));

  perform private.write_audit(caller, 'booking.cancel', 'booking', booking.id, v_reason,
    jsonb_build_object('from', booking.status, 'to', 'cancelled', 'settlement', v_settlement,
                       'start_date', booking.start_date, 'end_date', booking.end_date, 'total_due', booking.total_due));
  return 'cancelled';
end;
$$;

-- ---------------------------------------------------------------------------
-- Read functions gain a "no longer available" flag and the latest decision.
-- ---------------------------------------------------------------------------
drop function public.renter_bookings(uuid, integer, integer);
create function public.renter_bookings(p_booking_id uuid, p_limit integer, p_offset integer)
returns table (
  id uuid, product_id uuid, product_title text, product_area text, product_landmark text, cover_path text,
  listed_by text, start_date date, end_date date, pickup_at timestamptz, return_at timestamptz,
  rental_days integer, price_per_day numeric, deposit numeric, rental_amount numeric, total_due numeric,
  note text, status public.booking_status, phase public.rental_phase, created_at timestamptz,
  no_longer_available boolean, decision_reason text, total_count bigint
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
         (b.status = 'pending' and exists (
            select 1 from public.bookings o
            where o.product_id = b.product_id and o.id <> b.id and o.status in ('confirmed', 'completed')
              and daterange(o.start_date, o.end_date, '[]') && daterange(b.start_date, b.end_date, '[]'))),
         (select e.reason from public.booking_events e
          where e.booking_id = b.id and e.event_type in ('request_rejected', 'request_cancelled', 'admin_cancelled')
          order by e.created_at desc limit 1),
         count(*) over ()
  from public.bookings b
  join public.products p on p.id = b.product_id
  join public.profiles pr on pr.id = b.provider_id
  where b.renter_id = caller and (p_booking_id is null or b.id = p_booking_id)
  order by b.created_at desc, b.id
  limit page_size offset page_offset;
end;
$$;

drop function public.provider_booking_requests(public.booking_status, uuid, integer, integer);
create function public.provider_booking_requests(
  p_status public.booking_status, p_booking_id uuid, p_limit integer, p_offset integer
)
returns table (
  id uuid, product_id uuid, product_title text, renter_name text,
  start_date date, end_date date, pickup_at timestamptz, return_at timestamptz,
  rental_days integer, price_per_day numeric, deposit numeric, rental_amount numeric, total_due numeric,
  note text, status public.booking_status, created_at timestamptz,
  no_longer_available boolean, pickup_expired boolean, total_count bigint
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
         (b.status = 'pending' and exists (
            select 1 from public.bookings o
            where o.product_id = b.product_id and o.id <> b.id and o.status in ('confirmed', 'completed')
              and daterange(o.start_date, o.end_date, '[]') && daterange(b.start_date, b.end_date, '[]'))),
         (b.status = 'pending' and b.pickup_at <= pg_catalog.now()),
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

revoke all on function public.transition_booking(uuid, text, text) from public, anon;
revoke all on function public.admin_cancel_booking(uuid, text, text) from public, anon;
revoke all on function public.renter_bookings(uuid, integer, integer) from public, anon;
revoke all on function public.provider_booking_requests(public.booking_status, uuid, integer, integer) from public, anon;
grant execute on function public.transition_booking(uuid, text, text) to authenticated;
grant execute on function public.admin_cancel_booking(uuid, text, text) to authenticated;
grant execute on function public.renter_bookings(uuid, integer, integer) to authenticated;
grant execute on function public.provider_booking_requests(public.booking_status, uuid, integer, integer) to authenticated;
