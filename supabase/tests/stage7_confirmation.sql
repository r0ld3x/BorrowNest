-- BorrowNest Stage 7: confirmation and reservation boundary tests.
-- Runs as authenticated users with JWT claims, then rolls back.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stage7_confirmation.sql

\set QUIET on
begin;

create function pg_temp.expect(condition boolean, description text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'BOUNDARY TEST FAILED: %', description;
  end if;
  raise notice 'ok - %', description;
end;
$$;

create function pg_temp.expect_error(statement text, expected text, description text)
returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'BOUNDARY TEST FAILED: % (statement succeeded)', description;
exception
  when others then
    if sqlerrm like 'BOUNDARY TEST FAILED%' then raise; end if;
    if (expected = 'denied' and sqlstate = '42501') or (expected = 'exclusion' and sqlstate = '23P01')
       or sqlerrm = 'BN:' || expected then
      raise notice 'ok - %', description;
    else
      raise exception 'BOUNDARY TEST FAILED: % (got % %)', description, sqlstate, sqlerrm;
    end if;
end;
$$;
grant execute on function pg_temp.expect(boolean, text) to authenticated;
grant execute on function pg_temp.expect_error(text, text, text) to authenticated;

\set ra '70000000-0000-4000-a000-0000000000a1'
\set rb '70000000-0000-4000-a000-0000000000b1'
\set pp '70000000-0000-4000-a000-0000000000c1'
\set pq '70000000-0000-4000-a000-0000000000d1'
\set ad '70000000-0000-4000-a000-0000000000e1'
\set l1 '71000000-0000-4000-a000-000000000001'
\set l2 '71000000-0000-4000-a000-000000000002'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ra', 'bn-test-c-renter-a@roldex.me', '{"full_name":"Asha Renter"}'),
  (:'rb', 'bn-test-c-renter-b@roldex.me', '{"full_name":"Bina Renter"}'),
  (:'pp', 'bn-test-c-provider-p@roldex.me', '{"full_name":"Prakash Provider","account_type":"provider"}'),
  (:'pq', 'bn-test-c-provider-q@roldex.me', '{"full_name":"Qadir Provider","account_type":"provider"}'),
  (:'ad', 'bn-test-c-admin@roldex.me', '{"full_name":"Admin"}');
update public.profiles set role = 'admin' where id = :'ad';
insert into public.products (id, provider_id, title, description, category, condition, price_per_day, deposit, area, listing_status) values
  (:'l1', :'pp', 'C7 sofa', 'A sofa for confirmation tests.', 'furniture', 'good', 100, 1000, 'Thatipur', 'published'),
  (:'l2', :'pp', 'C7 bicycle', 'A bicycle for confirmation tests.', 'bicycles', 'good', 50, 500, 'Lashkar', 'published');
insert into public.product_pickup_details (product_id, exact_address, pickup_instructions) values
  (:'l1', 'C7 SECRET SOFA ADDRESS', 'Ring the bell twice'), (:'l2', 'C7 SECRET BIKE ADDRESS', '');

select (now() at time zone 'Asia/Kolkata')::date as today \gset
select format('{"sub":"%s","role":"authenticated"}', :'ra') as ca, format('{"sub":"%s","role":"authenticated"}', :'rb') as cb,
       format('{"sub":"%s","role":"authenticated"}', :'pp') as cp, format('{"sub":"%s","role":"authenticated"}', :'pq') as cq,
       format('{"sub":"%s","role":"authenticated"}', :'ad') as cad \gset

create function pg_temp.req(product uuid, s integer, e integer) returns uuid language sql as $$
  select public.create_booking(product,
    (now() at time zone 'Asia/Kolkata')::date + s, (now() at time zone 'Asia/Kolkata')::date + e,
    (((now() at time zone 'Asia/Kolkata')::date + s)::text || ' 10:00+05:30')::timestamptz,
    (((now() at time zone 'Asia/Kolkata')::date + e)::text || ' 18:00+05:30')::timestamptz, '', gen_random_uuid())
$$;
grant execute on function pg_temp.req(uuid, integer, integer) to authenticated;

-- Requests ----------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.req(:'l1', 5, 7) as a1 \gset
select pg_temp.req(:'l1', 20, 22) as a20 \gset
select pg_temp.req(:'l1', 30, 32) as a30 \gset
select pg_temp.expect((select count(*) = 0 from public.booking_pickup_snapshots), 'before confirmation the renter sees no pickup snapshot');
select pg_temp.expect((select count(*) = 0 from public.product_pickup_details), 'before confirmation the renter sees no listing address');
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'confirm', '')$$, :'a1'), 'booking_not_found', 'a renter cannot confirm their own request');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
-- shares day 7 with a1
select pg_temp.req(:'l1', 7, 9) as b7 \gset
-- starts the day after a1 ends
select pg_temp.req(:'l1', 8, 10) as b8 \gset
-- same dates, different item
select pg_temp.req(:'l2', 5, 7) as b2 \gset
-- same dates as a20
select pg_temp.req(:'l1', 20, 22) as b20 \gset
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'cancel', '')$$, :'a1'), 'booking_not_found', 'renter B cannot cancel renter A''s request');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cq', true);
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'confirm', '')$$, :'a1'), 'booking_not_found', 'a non-owner provider cannot confirm');
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'reject', '')$$, :'a1'), 'booking_not_found', 'a non-owner provider cannot decline');
reset role;

-- Confirmation --------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'approve', '')$$, :'a1'), 'invalid_action', 'unknown actions are refused');
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'reject', %L)$$, :'a1', repeat('x', 501)), 'reason_too_long', 'reasons are bounded');
select pg_temp.expect(public.transition_booking(:'a1', 'confirm', '') = 'confirmed', 'the owning provider confirms a request');
select pg_temp.expect(public.transition_booking(:'a1', 'confirm', '') = 'confirmed', 'repeating the confirmation is a no-op');
select pg_temp.expect((select count(*) = 1 from public.booking_events where booking_id = :'a1' and event_type = 'request_confirmed'), 'exactly one confirmation event');
select pg_temp.expect(
  (select price_per_day = 100 and deposit = 1000 and total_due = 1300 and phase = 'awaiting_handover' from public.bookings where id = :'a1'),
  'confirmation keeps the original quote: 3 × ₹100 + ₹1,000 = ₹1,300');
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'confirm', '')$$, :'b7'), 'dates_unavailable', 'a range sharing an end date with a confirmed booking cannot be confirmed');
select pg_temp.expect((select status = 'pending' from public.bookings where id = :'b7'), 'the conflicting request stays pending');
select pg_temp.expect((select no_longer_available from public.provider_booking_requests(null, :'b7', 20, 0)), 'the provider sees it flagged as no longer available');
select pg_temp.expect(public.transition_booking(:'b8', 'confirm', '') = 'confirmed', 'the next-day range can be confirmed');
select pg_temp.expect(public.transition_booking(:'b2', 'confirm', '') = 'confirmed', 'the same dates on a different item can be confirmed');
select pg_temp.expect(public.transition_booking(:'a20', 'reject', '<img src=x onerror=alert(1)> Booked privately that week') = 'rejected', 'the provider declines a request with a reason');
select pg_temp.expect(public.transition_booking(:'b20', 'confirm', '') = 'confirmed', 'a declined request does not reserve: its dates can be confirmed for someone else');
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'confirm', '')$$, :'a20'), 'booking_not_pending', 'a declined request cannot be confirmed later (stale)');
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'reject', '')$$, :'a1'), 'booking_not_pending', 'a confirmed booking cannot be declined');
select pg_temp.expect((select count(*) = 1 from public.booking_pickup_snapshots where booking_id = :'a1'), 'the provider can read the snapshot for their confirmed booking');
reset role;

-- Address access after confirmation -----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect(
  (select exact_address = 'C7 SECRET SOFA ADDRESS' and pickup_instructions = 'Ring the bell twice' from public.booking_pickup_snapshots where booking_id = :'a1'),
  'the confirmed renter can read the pickup snapshot');
select pg_temp.expect((select count(*) = 1 from public.booking_pickup_snapshots), 'the renter sees only their own confirmed snapshot (not the declined one)');
select pg_temp.expect((select count(*) = 0 from public.product_pickup_details), 'the listing''s general address table stays closed to the renter');
select pg_temp.expect((select decision_reason = '<img src=x onerror=alert(1)> Booked privately that week' from public.renter_bookings(:'a20', 1, 0)), 'the renter sees the decline reason as plain text');
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'cancel', '')$$, :'a1'), 'booking_not_pending', 'a renter cannot cancel a confirmed booking themselves');
select pg_temp.expect(public.transition_booking(:'a30', 'cancel', 'Plans changed') = 'cancelled', 'the renter cancels their own pending request');
select pg_temp.expect(public.transition_booking(:'a30', 'cancel', '') = 'cancelled', 'repeating the cancellation is a no-op');
select pg_temp.expect((select count(*) = 1 from public.booking_events where booking_id = :'a30' and event_type = 'request_cancelled'), 'exactly one cancellation event');
select pg_temp.expect_error(format($$update public.bookings set status = 'confirmed' where id = %L$$, :'a30'), 'denied', 'the renter cannot change a status directly');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect((select count(*) = 0 from public.booking_pickup_snapshots where booking_id = :'a1'), 'another renter cannot read the snapshot');
select pg_temp.expect((select no_longer_available from public.renter_bookings(:'b7', 1, 0)), 'the blocked renter sees their request flagged as no longer available');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cq', true);
select pg_temp.expect((select count(*) = 0 from public.booking_pickup_snapshots), 'another provider cannot read any snapshot');
reset role;

-- The database itself refuses overlapping reservations -------------------------
select pg_temp.expect_error(format($$update public.bookings set status = 'confirmed' where id = %L$$, :'b7'), 'exclusion', 'even a direct update cannot create an overlapping reservation');
select pg_temp.expect_error(format($$insert into public.bookings (product_id, renter_id, provider_id, start_date, end_date, pickup_at, return_at, price_per_day, deposit, status, phase, request_key)
  values (%L, %L, %L, %L::date, %L::date, %L, %L, 100, 0, 'completed', 'returned', gen_random_uuid())$$,
  :'l1', :'rb', :'pp', :'today'::date + 6, :'today'::date + 6, (:'today'::date + 6)::text || ' 10:00+05:30', (:'today'::date + 6)::text || ' 18:00+05:30'),
  'exclusion', 'a completed row also counts as a reservation');

-- Completed history reserves and keeps short-lived address access
-- Fixture shortcut: Stage 9 normally requires both return confirmations.
alter table public.bookings disable trigger bookings_check_activation;
alter table public.bookings disable trigger bookings_check_completion;
update public.bookings set status = 'completed', phase = 'returned' where id = :'b2';
alter table public.bookings enable trigger bookings_check_activation;
alter table public.bookings enable trigger bookings_check_completion;
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect_error($$select pg_temp.req('71000000-0000-4000-a000-000000000002', 6, 6)$$, 'dates_unavailable', 'completed bookings keep their dates reserved');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect((select count(*) = 1 from public.booking_pickup_snapshots where booking_id = :'b2'), 'the renter keeps snapshot access to a recently completed booking');
reset role;

-- Suspensions, expiry, unpublished listings ---------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.req(:'l1', 40, 41) as a40 \gset
select pg_temp.req(:'l1', 45, 46) as a45 \gset
reset role;

update public.profiles set account_status = 'suspended' where id = :'pp';
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'confirm', '')$$, :'a40'), 'not_active_provider', 'a suspended provider cannot confirm');
select pg_temp.expect((select count(*) = 0 from public.booking_pickup_snapshots), 'a suspended provider loses snapshot access');
reset role;
update public.profiles set account_status = 'active' where id = :'pp';

update public.profiles set account_status = 'suspended' where id = :'ra';
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'confirm', '')$$, :'a40'), 'renter_inactive', 'a request from a suspended renter cannot be confirmed');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect((select count(*) = 0 from public.booking_pickup_snapshots), 'a suspended renter loses snapshot access');
reset role;
update public.profiles set account_status = 'active' where id = :'ra';

insert into public.bookings (product_id, renter_id, provider_id, start_date, end_date, pickup_at, return_at, price_per_day, deposit, request_key)
values (:'l1', :'rb', :'pp', :'today'::date - 1, :'today'::date - 1, ((:'today'::date - 1)::text || ' 10:00+05:30')::timestamptz, ((:'today'::date - 1)::text || ' 18:00+05:30')::timestamptz, 100, 0, gen_random_uuid())
returning id as stale \gset
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'confirm', '')$$, :'stale'), 'pickup_expired', 'a request whose pickup time has passed cannot be confirmed');
select pg_temp.expect((select pickup_expired from public.provider_booking_requests(null, :'stale', 20, 0)), 'the provider sees it flagged as expired');
select public.pause_listing(:'l1');
select pg_temp.expect_error(format($$select public.transition_booking(%L, 'confirm', '')$$, :'a40'), 'listing_unavailable', 'requests for a paused listing cannot be confirmed');
select public.resume_listing(:'l1');
reset role;

-- Admin support cancellation -------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect_error(format($$select public.admin_cancel_booking(%L, 'Provider cannot do this', '')$$, :'a1'), 'not_active_admin', 'providers cannot use admin cancellation');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select pg_temp.expect_error(format($$select public.admin_cancel_booking(%L, 'short', '')$$, :'a1'), 'reason_required', 'admin cancellation needs a reason');
select pg_temp.expect(public.admin_cancel_booking(:'a1', 'Provider reported the sofa damaged before pickup', 'No money changed hands') = 'cancelled', 'an admin cancels a confirmed booking before handover');
select pg_temp.expect(public.admin_cancel_booking(:'a1', 'Provider reported the sofa damaged before pickup', '') = 'cancelled', 'repeating the admin cancellation is a no-op');
select pg_temp.expect(
  (select count(*) = 1 from public.admin_audit_logs where target_id = :'a1' and action = 'booking.cancel' and summary ->> 'settlement' = 'No money changed hands'),
  'the cancellation and settlement note are audited once');
select pg_temp.expect((select count(*) = 1 from public.booking_events where booking_id = :'a1' and event_type = 'admin_cancelled'), 'exactly one admin cancellation event');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect((select count(*) = 0 from public.booking_pickup_snapshots where booking_id = :'a1'), 'after cancellation the renter loses the address');
reset role;
-- Days 5–6 overlapped only a1, so after its cancellation they are free again.
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.req(:'l1', 5, 6) as b5 \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect(public.transition_booking(:'b5', 'confirm', '') = 'confirmed', 'dates freed by a cancellation can be requested and confirmed again');
reset role;

-- Fixture shortcut: Stage 8 normally requires both handover confirmations.
alter table public.bookings disable trigger bookings_check_activation;
update public.bookings set phase = 'active' where id = :'b8';
alter table public.bookings enable trigger bookings_check_activation;
set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select pg_temp.expect_error(format($$select public.admin_cancel_booking(%L, 'Trying to bypass the return', '')$$, :'b8'), 'rental_in_progress', 'an admin cannot cancel a rental already handed over');
select pg_temp.expect_error(format($$select public.admin_cancel_booking(%L, 'Completed history must stay', '')$$, :'b2'), 'booking_not_cancellable', 'a completed booking cannot be cancelled');
reset role;

do $$ begin raise notice 'All Stage 7 boundary tests passed.'; end $$;
rollback;
