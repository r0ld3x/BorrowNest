-- BorrowNest Stage 6: booking request boundary tests.
-- Runs as anon / authenticated with JWT claims, then rolls back.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stage6_bookings.sql

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

-- 'denied' = insufficient privilege / RLS; 'check' = constraint; 'enum' = bad enum input.
create function pg_temp.expect_error(statement text, expected text, description text)
returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'BOUNDARY TEST FAILED: % (statement succeeded)', description;
exception
  when others then
    if sqlerrm like 'BOUNDARY TEST FAILED%' then raise; end if;
    if (expected = 'denied' and sqlstate = '42501')
       or (expected = 'check' and sqlstate = '23514')
       or (expected = 'enum' and sqlstate = '22P02')
       or sqlerrm = 'BN:' || expected then
      raise notice 'ok - %', description;
    else
      raise exception 'BOUNDARY TEST FAILED: % (got % %)', description, sqlstate, sqlerrm;
    end if;
end;
$$;
grant execute on function pg_temp.expect(boolean, text) to anon, authenticated;
grant execute on function pg_temp.expect_error(text, text, text) to anon, authenticated;

-- Fixtures ------------------------------------------------------------------
\set ra '60000000-0000-4000-a000-0000000000a1'
\set rb '60000000-0000-4000-a000-0000000000b1'
\set rs '60000000-0000-4000-a000-0000000000c1'
\set pp '60000000-0000-4000-a000-0000000000d1'
\set pq '60000000-0000-4000-a000-0000000000e1'
\set ad '60000000-0000-4000-a000-0000000000f1'
\set l1 '61000000-0000-4000-a000-000000000001'
\set l2 '61000000-0000-4000-a000-000000000002'
\set l3 '61000000-0000-4000-a000-000000000003'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ra', 'bn-test-b-renter-a@roldex.me', '{"full_name":"Renter Asha"}'),
  (:'rb', 'bn-test-b-renter-b@roldex.me', '{"full_name":"Renter Bina"}'),
  (:'rs', 'bn-test-b-renter-s@roldex.me', '{"full_name":"Renter Suspended"}'),
  (:'pp', 'bn-test-b-provider-p@roldex.me', '{"full_name":"Provider Prakash","account_type":"provider"}'),
  (:'pq', 'bn-test-b-provider-q@roldex.me', '{"full_name":"Provider Qadir","account_type":"provider"}'),
  (:'ad', 'bn-test-b-admin@roldex.me', '{"full_name":"Admin"}');
update public.profiles set account_status = 'suspended' where id = :'rs';
update public.profiles set role = 'admin' where id = :'ad';

insert into public.products (id, provider_id, title, description, category, condition, price_per_day, deposit, area, listing_status) values
  (:'l1', :'pp', 'B6 study table', 'Wooden study table with a drawer.', 'study_essentials', 'good', 55.55, 1200.50, 'Thatipur', 'published'),
  (:'l2', :'pq', 'B6 bicycle', 'Geared bicycle, recently serviced.', 'bicycles', 'good', 60, 1500, 'Lashkar', 'published'),
  (:'l3', :'pq', 'B6 draft', 'Not published yet, should be unbookable.', 'other', 'good', 10, 0, 'Morar', 'draft');
insert into public.product_pickup_details (product_id, exact_address) values
  (:'l1', 'B6 SECRET ADDRESS ONE'), (:'l2', 'B6 SECRET ADDRESS TWO'), (:'l3', 'B6 SECRET ADDRESS THREE');

select (now() at time zone 'Asia/Kolkata')::date as today \gset
select (:'today'::date - 1)::text as yesterday, (:'today'::date + 1)::text as d1, (:'today'::date + 2)::text as d2,
       (:'today'::date + 3)::text as d3, (:'today'::date + 10)::text as d10, (:'today'::date + 12)::text as d12,
       (:'today'::date + 13)::text as d13, (:'today'::date + 15)::text as d15,
       (:'today'::date + 180)::text as d180, (:'today'::date + 181)::text as d181, (:'today'::date + 366)::text as d366 \gset

-- A confirmed booking by renter B (operator-inserted; confirmation is Stage 7).
insert into public.bookings (product_id, renter_id, provider_id, start_date, end_date, pickup_at, return_at, price_per_day, deposit, status, request_key)
values (:'l1', :'rb', :'pp', :'d10', :'d12', (:'d10' || ' 10:00+05:30')::timestamptz, (:'d12' || ' 18:00+05:30')::timestamptz, 55.55, 1200.50, 'confirmed', gen_random_uuid());

select format('{"sub":"%s","role":"authenticated"}', :'ra') as claims_ra, format('{"sub":"%s","role":"authenticated"}', :'rb') as claims_rb,
       format('{"sub":"%s","role":"authenticated"}', :'rs') as claims_rs, format('{"sub":"%s","role":"authenticated"}', :'pp') as claims_pp,
       format('{"sub":"%s","role":"authenticated"}', :'pq') as claims_pq, format('{"sub":"%s","role":"authenticated"}', :'ad') as claims_ad \gset

-- A booking request call with explicit Gwalior times.
create function pg_temp.req(product uuid, s text, e text, pickup text, ret text, note text, k uuid)
returns uuid language sql as $$
  select public.create_booking(product, s::date, e::date, (s || ' ' || pickup || '+05:30')::timestamptz,
                               (e || ' ' || ret || '+05:30')::timestamptz, note, k)
$$;
grant execute on function pg_temp.req(uuid, text, text, text, text, text, uuid) to authenticated;

-- Renter A: dates around Gwalior midnight -----------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'claims_ra', true);

select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, :'l1', :'yesterday', :'yesterday'), 'start_too_soon', 'yesterday is too soon');
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, :'l1', :'today', :'today'), 'start_too_soon', 'today is too soon');
select pg_temp.expect(pg_temp.req(:'l1', :'d1', :'d1', '00:30', '23:30', '', gen_random_uuid()) is not null,
  'tomorrow is allowed, including a 00:30 IST pickup (still the previous day in UTC)');
select pg_temp.expect_error(format($$select public.create_booking(%L, %L, %L, %L, %L, '', gen_random_uuid())$$, :'l1', :'d1', :'d1', :'today' || ' 23:30+05:30', :'d1' || ' 18:00+05:30'),
  'pickup_not_on_start', 'pickup at 23:30 IST the night before is not on the start date');
select pg_temp.expect_error(format($$select public.create_booking(%L, %L, %L, %L, %L, '', gen_random_uuid())$$, :'l1', :'d1', :'d2', :'d1' || ' 10:00+05:30', :'d2' || ' 19:00+00:00'),
  'return_not_on_end', 'a return at 19:00 UTC on the end date (00:30 IST the next day) is rejected');
select pg_temp.expect(public.create_booking(:'l1', :'d1', :'d2', (:'d1' || ' 10:00+05:30')::timestamptz, (:'d1' || ' 23:00+00:00')::timestamptz, '', gen_random_uuid()) is not null,
  'a return at 23:00 UTC the day before (04:30 IST on the end date) is accepted');
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '18:00', '10:00', '', gen_random_uuid())$$, :'l1', :'d2', :'d2'), 'return_before_pickup', 'one-day rental must return after pickup');
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, :'l1', :'d3', :'d2'), 'end_before_start', 'end before start is rejected');
-- (on the second listing, which has no confirmed bookings in this range)
select pg_temp.expect(pg_temp.req(:'l2', :'d1', :'d180', '10:00', '18:00', '', gen_random_uuid()) is not null, '180 inclusive days are allowed');
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, :'l2', :'d1', :'d181'), 'rental_too_long', '181 days are rejected');
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, :'l1', :'d366', :'d366'), 'start_too_far', 'starts more than a year ahead are rejected');
select pg_temp.expect_error(format($$select public.create_booking(%L, %L, %L, null, null, '', gen_random_uuid())$$, :'l1', :'d1', :'d2'), 'invalid_dates', 'missing times are rejected');

-- Pricing comes from the database, exactly --------------------------------------
select pg_temp.req(:'l1', :'d1', :'d3', '10:00', '18:00', '<script>alert(1)</script> please call first', '62000000-0000-4000-a000-000000000001') as b1 \gset
select pg_temp.expect(
  (select rental_days = 3 and price_per_day = 55.55 and deposit = 1200.50 and rental_amount = 166.65 and total_due = 1367.15
          and status = 'pending' and phase = 'awaiting_handover' and provider_id = :'pp'::uuid and renter_id = :'ra'::uuid
   from public.bookings where id = :'b1'),
  'request snapshots price, deposit and provider; 3 × ₹55.55 + ₹1,200.50 = ₹1,367.15 exactly');
select pg_temp.expect((select note = '<script>alert(1)</script> please call first' from public.bookings where id = :'b1'), 'HTML-looking notes are stored verbatim as text');
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', repeat('x', 501), gen_random_uuid())$$, :'l1', :'d1', :'d2'), 'invalid_note', 'overlong notes are rejected');

-- Idempotency
select pg_temp.expect(pg_temp.req(:'l1', :'d1', :'d3', '10:00', '18:00', '<script>alert(1)</script> please call first', '62000000-0000-4000-a000-000000000001') = :'b1',
  'repeating the same request with the same key returns the original booking');
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', '62000000-0000-4000-a000-000000000001')$$, :'l1', :'d2', :'d3'),
  'request_key_conflict', 'reusing a key with different dates is a conflict');
select pg_temp.expect((select count(*) = 1 from public.bookings where request_key = '62000000-0000-4000-a000-000000000001'), 'only one booking exists for that key');
select pg_temp.expect_error($$select public.create_booking(null, current_date + 5, current_date + 6, now() + interval '5 days', now() + interval '6 days', '', null)$$, 'invalid_request', 'a missing request key is rejected');

-- Reservations: pending never blocks; confirmed does ---------------------------
select pg_temp.expect(pg_temp.req(:'l1', :'d1', :'d3', '11:00', '17:00', 'second pending', gen_random_uuid()) is not null, 'overlapping pending requests are allowed');
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, :'l1', :'d12', :'d15'), 'dates_unavailable', 'a range touching a confirmed booking''s last day is unavailable');
select pg_temp.expect(pg_temp.req(:'l1', :'d13', :'d15', '10:00', '18:00', '', gen_random_uuid()) is not null, 'the day after a confirmed booking is available');

-- Availability exposes dates only, for public listings only
select pg_temp.expect(
  (select array_agg(blocked_date order by blocked_date) = array[:'d10'::date, :'d10'::date + 1, :'d12'::date]
   from public.product_blocked_dates(:'l1', (:'today'::date - 30), :'today'::date + 30)),
  'blocked dates list exactly the confirmed days, starting from today');
select pg_temp.expect(
  pg_catalog.pg_get_function_result('public.product_blocked_dates(uuid, date, date)'::regprocedure) = 'TABLE(blocked_date date)',
  'the availability feed returns dates only (no ids, renters or counts)');

-- Forgery and immutability
select pg_temp.expect_error(format($$insert into public.bookings (product_id, renter_id, provider_id, start_date, end_date, pickup_at, return_at, price_per_day, deposit, request_key) values (%L, %L, %L, %L, %L, now() + interval '1 day', now() + interval '2 days', 1, 0, gen_random_uuid())$$, :'l1', :'ra', :'pp', :'d1', :'d2'),
  'denied', 'renter cannot insert a booking directly with a chosen price');
select pg_temp.expect_error(format($$update public.bookings set price_per_day = 1 where id = %L$$, :'b1'), 'denied', 'renter cannot change the price');
select pg_temp.expect_error(format($$update public.bookings set status = 'confirmed' where id = %L$$, :'b1'), 'denied', 'renter cannot confirm their own request');
select pg_temp.expect_error(format($$delete from public.bookings where id = %L$$, :'b1'), 'denied', 'renter cannot delete a booking');
select pg_temp.expect_error(format($$insert into public.booking_events (booking_id, event_type) values (%L, 'request_created')$$, :'b1'), 'denied', 'renter cannot forge booking events');
select pg_temp.expect((select count(*) = 1 from public.booking_events where booking_id = :'b1' and event_type = 'request_created' and next_status = 'pending'), 'the request event was recorded once');
select pg_temp.expect((select count(*) = 0 from public.product_pickup_details), 'a pending renter cannot read any pickup address');
select pg_temp.expect((select count(*) = 0 from public.booking_pickup_snapshots), 'a pending renter cannot read pickup snapshots');
select pg_temp.expect((select count(*) = 1 from public.renter_bookings(:'b1', 20, 0)), 'renter reads their own booking');
select pg_temp.expect(
  pg_catalog.pg_get_function_result('public.renter_bookings(uuid, integer, integer)'::regprocedure) !~* '(address|instruction|email|renter_id|provider_id)',
  'renter booking view has no address, email or participant ids');

-- Listing availability
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, :'l3', :'d1', :'d2'), 'listing_unavailable', 'a draft listing cannot be requested');
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, '00000000-0000-4000-a000-000000000000', :'d1', :'d2'), 'listing_unavailable', 'an unknown listing cannot be requested');
reset role;

-- A price change after the request leaves the snapshot alone ---------------------
update public.products set price_per_day = 99, deposit = 5000 where id = :'l1';
select pg_temp.expect((select price_per_day = 55.55 and deposit = 1200.50 and total_due = 1367.15 from public.bookings where id = :'b1'), 'a later price change does not alter the request');
select pg_temp.expect_error(format($$update public.bookings set price_per_day = 1 where id = %L$$, :'b1'), 'booking_terms_immutable', 'even trusted code cannot rewrite booking terms');
select pg_temp.expect_error(format($$update public.bookings set start_date = start_date + 1 where id = %L$$, :'b1'), 'booking_terms_immutable', 'dates are immutable after creation');
select pg_temp.expect_error(format($$insert into public.bookings (product_id, renter_id, provider_id, start_date, end_date, pickup_at, return_at, price_per_day, deposit, request_key) values (%L, %L, %L, %L, %L, %L, %L, 1, 0, gen_random_uuid())$$,
  :'l1', :'ra', :'pq', :'d1', :'d2', :'d1' || ' 10:00+05:30', :'d2' || ' 10:00+05:30'), 'booking_provider_mismatch', 'the provider must be the listing owner');
select pg_temp.expect_error(format($$insert into public.bookings (product_id, renter_id, provider_id, start_date, end_date, pickup_at, return_at, price_per_day, deposit, phase, request_key) values (%L, %L, %L, %L, %L, %L, %L, 1, 0, 'active', gen_random_uuid())$$,
  :'l1', :'ra', :'pp', :'d1', :'d2', :'d1' || ' 10:00+05:30', :'d2' || ' 10:00+05:30'), 'check', 'a pending booking cannot be in an active rental phase');

-- Leap day, computed by the database (beyond the one-year request window, so inserted directly)
insert into public.bookings (product_id, renter_id, provider_id, start_date, end_date, pickup_at, return_at, price_per_day, deposit, request_key)
values (:'l1', :'ra', :'pp', '2028-02-28', '2028-03-01', '2028-02-28 10:00+05:30', '2028-03-01 18:00+05:30', 55.55, 0, gen_random_uuid())
returning id as leap \gset
select pg_temp.expect((select rental_days = 3 and rental_amount = 166.65 from public.bookings where id = :'leap'), 'across 29 Feb 2028 the database counts 3 days');

-- Other users ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'claims_rb', true);
select pg_temp.expect((select count(*) = 0 from public.bookings where id = :'b1'), 'renter B cannot read renter A''s booking by id');
select pg_temp.expect((select count(*) = 0 from public.renter_bookings(:'b1', 20, 0)), 'renter B gets nothing from the booking RPC for A''s id');
select pg_temp.expect((select count(*) = 0 from public.booking_events where booking_id = :'b1'), 'renter B cannot read A''s booking events');
select pg_temp.expect((select count(*) = 1 from public.bookings), 'renter B sees only their own booking');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'claims_pp', true);
select pg_temp.expect((select count(*) >= 1 from public.provider_booking_requests('pending', :'b1', 20, 0)), 'the listing''s provider sees the request');
select pg_temp.expect((select renter_name = 'Renter' from public.provider_booking_requests('pending', :'b1', 20, 0)), 'the provider sees only the renter''s first name');
select pg_temp.expect_error($$select * from public.provider_booking_requests('approved', null, 20, 0)$$, 'enum', 'unexpected status values are rejected');
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, :'l2', :'d1', :'d2'), 'not_active_renter', 'a provider cannot create booking requests');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'claims_pq', true);
select pg_temp.expect((select count(*) = 0 from public.provider_booking_requests(null, :'b1', 20, 0)), 'another provider cannot see the request');
select pg_temp.expect((select count(*) = 0 from public.bookings where id = :'b1'), 'another provider cannot read the booking row');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'claims_rs', true);
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, :'l2', :'d1', :'d2'), 'not_active_renter', 'a suspended renter cannot create requests');
select pg_temp.expect_error($$select * from public.renter_bookings(null, 20, 0)$$, 'not_active_renter', 'a suspended renter cannot read bookings');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'claims_ad', true);
select pg_temp.expect((select count(*) >= 5 from public.bookings where product_id = :'l1'), 'an active admin can inspect all bookings');
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, :'l2', :'d1', :'d2'), 'not_active_renter', 'an admin cannot create requests on anyone''s behalf');
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, :'l2', :'d1', :'d2'), 'denied', 'visitors cannot create requests');
select pg_temp.expect_error($$select * from public.bookings$$, 'denied', 'visitors cannot read bookings');
select pg_temp.expect((select count(*) = 0 from public.product_blocked_dates(:'l3', null, null)), 'no availability is exposed for unpublished listings');
reset role;

-- Suspended provider's listing becomes unbookable
update public.profiles set account_status = 'suspended' where id = :'pq';
set local role authenticated;
select set_config('request.jwt.claims', :'claims_rb', true);
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, :'l2', :'d1', :'d2'), 'listing_unavailable', 'a suspended provider''s listing cannot be requested');

-- Abuse limit: 20 open requests per renter
do $$
declare i integer;
begin
  for i in 1..20 loop
    perform pg_temp.req('61000000-0000-4000-a000-000000000001', ((now() at time zone 'Asia/Kolkata')::date + 20 + i)::text,
                        ((now() at time zone 'Asia/Kolkata')::date + 20 + i)::text, '10:00', '18:00', '', gen_random_uuid());
  end loop;
end $$;
select pg_temp.expect_error(format($$select pg_temp.req(%L, %L, %L, '10:00', '18:00', '', gen_random_uuid())$$, :'l1', :'d1', :'d2'), 'too_many_requests', 'the 21st open request is refused (limit 20)');
reset role;

do $$ begin raise notice 'All Stage 6 boundary tests passed.'; end $$;
rollback;
