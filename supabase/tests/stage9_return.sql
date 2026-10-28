-- BorrowNest Stage 9: mutual return and deposit settlement boundary tests.
-- Runs as authenticated users with JWT claims, then rolls back.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stage9_return.sql

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
    if (expected = 'denied' and sqlstate = '42501') or (expected = 'check' and sqlstate = '23514')
       or sqlerrm = 'BN:' || expected then
      raise notice 'ok - %', description;
    else
      raise exception 'BOUNDARY TEST FAILED: % (got % %)', description, sqlstate, sqlerrm;
    end if;
end;
$$;
grant execute on function pg_temp.expect(boolean, text) to authenticated;
grant execute on function pg_temp.expect_error(text, text, text) to authenticated;

\set ra '90000000-0000-4000-a000-0000000000a1'
\set rb '90000000-0000-4000-a000-0000000000b1'
\set pp '90000000-0000-4000-a000-0000000000c1'
\set pq '90000000-0000-4000-a000-0000000000d1'
\set ad '90000000-0000-4000-a000-0000000000e1'
\set l1 '91000000-0000-4000-a000-000000000001'
\set late '92000000-0000-4000-a000-000000000001'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ra', 'bn-test-r-renter-a@roldex.me', '{"full_name":"Asha Renter"}'),
  (:'rb', 'bn-test-r-renter-b@roldex.me', '{"full_name":"Bina Renter"}'),
  (:'pp', 'bn-test-r-provider-p@roldex.me', '{"full_name":"Prakash Provider","account_type":"provider"}'),
  (:'pq', 'bn-test-r-provider-q@roldex.me', '{"full_name":"Qadir Provider","account_type":"provider"}'),
  (:'ad', 'bn-test-r-admin@roldex.me', '{"full_name":"Admin"}');
update public.profiles set role = 'admin' where id = :'ad';
insert into public.products (id, provider_id, title, description, category, condition, price_per_day, deposit, area, listing_status) values
  (:'l1', :'pp', 'R9 sofa', 'A sofa for return tests.', 'furniture', 'good', 100, 1000, 'Thatipur', 'published');
insert into public.product_pickup_details (product_id, exact_address, pickup_instructions) values (:'l1', 'R9 secret address', '');

select format('{"sub":"%s","role":"authenticated"}', :'ra') as ca, format('{"sub":"%s","role":"authenticated"}', :'rb') as cb,
       format('{"sub":"%s","role":"authenticated"}', :'pp') as cp, format('{"sub":"%s","role":"authenticated"}', :'pq') as cq,
       format('{"sub":"%s","role":"authenticated"}', :'ad') as cad \gset

-- Helpers: IST timestamps relative to today, and a full request -> active flow.
create function pg_temp.ist(days integer, hhmm text) returns timestamptz language sql as $$
  select ((((now() at time zone 'Asia/Kolkata')::date + days)::text) || ' ' || hhmm || '+05:30')::timestamptz
$$;
create function pg_temp.active_rental(s integer, e integer) returns uuid language plpgsql as $$
declare b uuid; x uuid;
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', '90000000-0000-4000-a000-0000000000a1'), true);
  b := public.create_booking('91000000-0000-4000-a000-000000000001',
    (now() at time zone 'Asia/Kolkata')::date + s, (now() at time zone 'Asia/Kolkata')::date + e,
    pg_temp.ist(s, '10:00'), pg_temp.ist(e, '18:00'), '', gen_random_uuid());
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', '90000000-0000-4000-a000-0000000000c1'), true);
  perform public.transition_booking(b, 'confirm', '');
  x := public.prepare_handover(b, 'Good condition', 'cash');
  perform public.confirm_handover(x, 1, array['handed_over_item','condition_matches','received_amounts']);
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', '90000000-0000-4000-a000-0000000000a1'), true);
  perform public.confirm_handover(x, 1, array['received_item','condition_agreed','paid_amounts']);
  return b;
end $$;
grant execute on function pg_temp.ist(integer, text) to authenticated;
grant execute on function pg_temp.active_rental(integer, integer) to authenticated;

set local role authenticated;
-- a1: days 5-7 (3 x 100 = 300 rent, 1000 deposit); a3, a4 for refund cases.
select pg_temp.active_rental(5, 7) as a1, pg_temp.active_rental(20, 21) as a3, pg_temp.active_rental(30, 31) as a4 \gset
select set_config('request.jwt.claims', :'ca', true) \gset ignored_
select public.create_booking(:'l1', (now() at time zone 'Asia/Kolkata')::date + 10, (now() at time zone 'Asia/Kolkata')::date + 11,
  pg_temp.ist(10, '10:00'), pg_temp.ist(11, '18:00'), '', gen_random_uuid()) as a2 \gset
select public.create_booking(:'l1', (now() at time zone 'Asia/Kolkata')::date + 40, (now() at time zone 'Asia/Kolkata')::date + 41,
  pg_temp.ist(40, '10:00'), pg_temp.ist(41, '18:00'), '', gen_random_uuid()) as apend \gset
select public.create_booking(:'l1', (now() at time zone 'Asia/Kolkata')::date + 50, (now() at time zone 'Asia/Kolkata')::date + 51,
  pg_temp.ist(50, '10:00'), pg_temp.ist(51, '18:00'), '', gen_random_uuid()) as acanc \gset
select public.transition_booking(:'acanc', 'cancel', '') \gset ignored_
select set_config('request.jwt.claims', :'cp', true) \gset ignored_
select public.transition_booking(:'a2', 'confirm', '') \gset ignored_
reset role;
select pg_temp.expect((select count(*) = 3 from public.bookings where id in (:'a1', :'a3', :'a4') and phase = 'active'), 'fixtures: three active rentals after real dual handovers');

-- Who can schedule -------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect_error(format($$select public.propose_return(%L, pg_temp.ist(6, '12:00'), '', 0)$$, :'a1'), 'booking_not_found', 'another renter cannot propose a return');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cq', true);
select pg_temp.expect_error(format($$select public.propose_return(%L, pg_temp.ist(6, '12:00'), '', 0)$$, :'a1'), 'booking_not_found', 'another provider cannot propose a return');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select pg_temp.expect_error(format($$select public.propose_return(%L, pg_temp.ist(6, '12:00'), '', 0)$$, :'a1'), 'booking_not_found', 'an admin cannot propose for a participant');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect_error(format($$select public.propose_return(%L, pg_temp.ist(11, '12:00'), '', 0)$$, :'a2'), 'rental_not_active', 'a booking not yet handed over cannot be returned');
select pg_temp.expect_error(format($$select public.propose_return(%L, pg_temp.ist(41, '12:00'), '', 0)$$, :'apend'), 'rental_not_active', 'a pending request cannot be returned');
select pg_temp.expect_error(format($$select public.propose_return(%L, pg_temp.ist(51, '12:00'), '', 0)$$, :'acanc'), 'rental_not_active', 'a cancelled booking cannot be returned');
select pg_temp.expect_error(format($$select public.propose_return(%L, now() - interval '1 minute', '', 0)$$, :'a1'), 'proposal_in_past', 'a return time in the past is refused');
-- Timezone edge: the scheduled return is day 7 at 18:00 IST (12:30 UTC).
select pg_temp.expect_error(format($$select public.propose_return(%L, pg_temp.ist(7, '18:00') + interval '1 second', '', 0)$$, :'a1'), 'after_scheduled_return', 'one second after the scheduled return (IST) is refused: no extensions');
select pg_temp.expect_error(format($$select public.propose_return(%L, pg_temp.ist(6, '12:00'), '', 1)$$, :'a1'), 'stale_proposal', 'a proposal against an unseen version is refused');
select public.propose_return(:'a1', pg_temp.ist(7, '18:00'), '<b>evening</b> works for me', 0) as p1 \gset
select pg_temp.expect((select version = 1 and status = 'pending' and proposer_role = 'renter' and note = '<b>evening</b> works for me' from public.return_proposals where id = :'p1'),
  'exactly at the scheduled return time (IST) is allowed; note stored as plain text');
select pg_temp.expect_error(format($$select public.accept_return(%L)$$, :'p1'), 'cannot_accept_own_proposal', 'a participant cannot accept their own proposal');
select pg_temp.expect_error(format($$update public.return_proposals set status = 'accepted' where id = %L$$, :'p1'), 'denied', 'clients cannot accept by writing rows');
select pg_temp.expect_error(format($$insert into public.return_proposals (booking_id, version, proposed_by, proposer_role, proposed_at) values (%L, 9, %L, 'provider', now())$$, :'a1', :'pp'), 'denied', 'clients cannot insert proposals as someone else');
select pg_temp.expect_error(format($$update public.bookings set phase = 'return_requested' where id = %L$$, :'a1'), 'denied', 'clients cannot set the phase directly');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect((select count(*) = 0 from public.return_proposals where booking_id = :'a1'), 'another renter cannot see the proposals');
select pg_temp.expect_error(format($$select public.accept_return(%L)$$, :'p1'), 'booking_not_found', 'another renter cannot accept');
reset role;

-- Counterproposal and acceptance ------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect_error(format($$select public.propose_return(%L, pg_temp.ist(6, '12:00'), '', 0)$$, :'a1'), 'stale_proposal', 'a counterproposal must have seen the latest version');
select public.propose_return(:'a1', pg_temp.ist(6, '12:00'), 'Noon suits me better', 1) as p2 \gset
select pg_temp.expect((select status = 'superseded' from public.return_proposals where id = :'p1'), 'the counterproposal supersedes the original');
select pg_temp.expect_error(format($$select public.accept_return(%L)$$, :'p2'), 'cannot_accept_own_proposal', 'the provider cannot accept their own counterproposal');
select pg_temp.expect_error(format($$select public.accept_return(%L)$$, :'p1'), 'stale_proposal', 'the renter''s superseded proposal can no longer be accepted by the provider');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect(public.accept_return(:'p2') = 'return_requested', 'the renter accepts the counterproposal');
select pg_temp.expect(public.accept_return(:'p2') = 'return_requested', 'repeating the acceptance is a no-op');
select pg_temp.expect((select count(*) = 1 from public.booking_events where booking_id = :'a1' and event_type = 'return_accepted'), 'exactly one acceptance event');
select pg_temp.expect(
  (select phase = 'return_requested' and status = 'confirmed' and start_date = (now() at time zone 'Asia/Kolkata')::date + 5
     and return_at = pg_temp.ist(7, '18:00') and rental_amount = 300 from public.bookings where id = :'a1'),
  'acceptance changes only the phase: dates, scheduled return and rent unchanged');
select pg_temp.expect_error(format($$select public.prepare_return(%L, 'Fine', 0, '', 'upi')$$, :'a1'), 'provider_prepares_return', 'the renter cannot prepare the return summary');
-- Rescheduling before any return summary: back to active until accepted.
select public.propose_return(:'a1', pg_temp.ist(7, '09:00'), 'Earlier please', 2) as p3 \gset
select pg_temp.expect((select phase = 'active' from public.bookings where id = :'a1') and (select status = 'superseded' from public.return_proposals where id = :'p2'),
  'a new proposal replaces the accepted one and returns the rental to active');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect_error(format($$select public.prepare_return(%L, 'Fine', 0, '', 'upi')$$, :'a1'), 'return_not_open', 'no return summary before a time is agreed');
select pg_temp.expect(public.accept_return(:'p3') = 'return_requested', 'the provider accepts the renter''s new time');

-- Settlement validation -----------------------------------------------------------
select pg_temp.expect_error(format($$select public.prepare_return(%L, 'Fine', -1, 'Negative', 'upi')$$, :'a1'), 'invalid_deduction', 'a negative deduction is refused');
select pg_temp.expect_error(format($$select public.prepare_return(%L, 'Fine', 1000.01, 'Over the deposit', 'upi')$$, :'a1'), 'invalid_deduction', 'a deduction above the deposit is refused');
select pg_temp.expect_error(format($$select public.prepare_return(%L, 'Fine', 0.001, 'Fraction', 'upi')$$, :'a1'), 'invalid_deduction', 'a deduction finer than one paisa is refused');
select pg_temp.expect_error(format($$select public.prepare_return(%L, 'Fine', 200, '', 'upi')$$, :'a1'), 'deduction_reason_required', 'a deduction needs a reason');
select pg_temp.expect_error(format($$select public.prepare_return(%L, 'Fine', 200, 'Cleaning', 'none')$$, :'a1'), 'invalid_payment_method', 'a refund due needs a refund method');
select pg_temp.expect_error(format($$select public.prepare_return(%L, ' ', 0, '', 'upi')$$, :'a1'), 'invalid_condition_notes', 'return condition notes are required');
select public.prepare_return(:'a1', '<script>alert(1)</script> Stain on the middle cushion', 200, 'Cushion cleaning <img src=x>', 'cash') as r1 \gset
select pg_temp.expect(
  (select kind = 'return' and revision = 1 and deposit_amount = 1000 and deduction_amount = 200 and refund_due = 800 and payment_method = 'cash'
     and condition_notes = '<script>alert(1)</script> Stain on the middle cushion' and deduction_reason = 'Cushion cleaning <img src=x>'
     and scheduled_at = pg_temp.ist(7, '09:00')
   from public.booking_exchanges where id = :'r1'),
  'the return summary: ₹1,000 deposit − ₹200 = ₹800 refund at the agreed time; text stored as plain text');
select pg_temp.expect_error(format($$select public.prepare_return(%L, 'Again', 0, '', 'upi')$$, :'a1'), 'return_exists', 'only one return summary is prepared');
select pg_temp.expect_error(format($$select public.propose_return(%L, pg_temp.ist(6, '15:00'), '', 3)$$, :'a1'), 'return_in_progress', 'the time cannot be rescheduled once a return summary exists');
select pg_temp.expect_error(format($$update public.booking_exchanges set deduction_amount = 0 where id = %L$$, :'r1'), 'denied', 'clients cannot edit the settlement');
reset role;

-- Confirmations -------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect_error(format($$select public.confirm_return(%L, 1, 200, 800, array['returned_item','settlement_agreed'])$$, :'r1'), 'acknowledgements_required', 'every renter acknowledgement is required');
select pg_temp.expect_error(format($$select public.confirm_return(%L, 1, 200, 800, array['received_item','condition_matches','refund_paid'])$$, :'r1'), 'acknowledgements_required', 'the renter cannot make the provider''s assertions');
select pg_temp.expect_error(format($$select public.confirm_return(%L, 1, 0, 800, array['returned_item','settlement_agreed','refund_received'])$$, :'r1'), 'settlement_mismatch', 'a forged deduction is refused');
select pg_temp.expect_error(format($$select public.confirm_return(%L, 1, 200, 1000, array['returned_item','settlement_agreed','refund_received'])$$, :'r1'), 'settlement_mismatch', 'a forged refund is refused');
select pg_temp.expect_error(format($$select public.confirm_return(%L, 2, 200, 800, array['returned_item','settlement_agreed','refund_received'])$$, :'r1'), 'stale_revision', 'a revision that is not current is refused');
select pg_temp.expect(public.confirm_return(:'r1', 1, 200, 800, array['returned_item','settlement_agreed','refund_received']) = 'return_requested', 'the first return confirmation waits');
select pg_temp.expect(public.confirm_return(:'r1', 1, 200, 800, array['returned_item','settlement_agreed','refund_received']) = 'return_requested', 'repeating it is a no-op');
select pg_temp.expect((select status = 'confirmed' and phase = 'return_requested' from public.bookings where id = :'a1'), 'one confirmation never completes the booking');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect_error(format($$select public.confirm_return(%L, 1, 200, 800, array['returned_item','settlement_agreed','refund_received'])$$, :'r1'), 'booking_not_found', 'another renter cannot confirm');
select pg_temp.expect((select count(*) = 0 from public.booking_exchanges where booking_id = :'a1'), 'another renter cannot read the return summary');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select pg_temp.expect_error(format($$select public.confirm_return(%L, 1, 200, 800, array['received_item','condition_matches','refund_paid'])$$, :'r1'), 'booking_not_found', 'an admin cannot confirm for the provider');
reset role;

-- Correction invalidates the earlier confirmation.
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect_error(format($$select public.revise_return(%L, 1, 'Stain on the middle cushion', 100, 'Cleaning', 'cash', '')$$, :'r1'), 'reason_required', 'a return correction needs a reason');
select public.revise_return(:'r1', 1, 'Stain on the middle cushion', 100, 'Spot cleaning only', 'cash', 'We agreed ₹100 in person') as r2 \gset
select pg_temp.expect((select revision = 2 and deduction_amount = 100 and refund_due = 900 from public.booking_exchanges where id = :'r2')
  and (select status = 'superseded' from public.booking_exchanges where id = :'r1'), 'the correction is revision 2 (₹900 refund); revision 1 kept as superseded');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect_error(format($$select public.confirm_return(%L, 1, 200, 800, array['received_item','condition_matches','refund_paid'])$$, :'r1'), 'stale_revision', 'the provider cannot confirm the superseded settlement');

-- Issue hold blocks completion.
select public.open_dispute(:'a1', 'condition', 'Renter disputes the cushion stain amount') as issue \gset
select pg_temp.expect_error(format($$select public.confirm_return(%L, 2, 100, 900, array['received_item','condition_matches','refund_paid'])$$, :'r2'), 'issue_open', 'an open issue blocks return confirmation');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select admin_resolve_dispute(:'issue', 'no_action', 'Both agreed ₹100 deduction by phone', '', 0, 0, '', 'with_renter') \gset ignored_
reset role;

-- Dual confirmation completes exactly once.
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect(public.confirm_return(:'r2', 2, 100, 900, array['received_item','condition_matches','refund_paid']) = 'return_requested', 'the provider confirms revision 2 and waits (renter''s revision 1 confirmation does not count)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect(public.confirm_return(:'r2', 2, 100, 900, array['returned_item','settlement_agreed','refund_received']) = 'returned', 'the second confirmation completes the booking');
select pg_temp.expect(public.confirm_return(:'r2', 2, 100, 900, array['returned_item','settlement_agreed','refund_received']) = 'returned', 'repeating after completion is a no-op');
select pg_temp.expect((select status = 'completed' and phase = 'returned' and rental_amount = 300 and deposit = 1000 from public.bookings where id = :'a1'), 'completed and returned; rent and deposit snapshot unchanged');
select pg_temp.expect((select count(*) = 1 from public.booking_events where booking_id = :'a1' and event_type = 'rental_completed'), 'exactly one completion event');
select public.open_dispute(:'a1', 'refund', 'Refund not received after completion') as late_dispute \gset
select pg_temp.expect((select post_completion from public.booking_disputes where id = :'late_dispute'), 'a dispute after completion is a post-completion support case (Stage 10)');
select pg_temp.expect((select status = 'completed' from public.bookings where id = :'a1'), 'and the completed booking is not reopened');
reset role;
select pg_temp.expect(
  (select count(*) = 3 from public.product_blocked_dates(:'l1', (now() at time zone 'Asia/Kolkata')::date + 5, (now() at time zone 'Asia/Kolkata')::date + 7)),
  'an early return keeps the original dates reserved');

-- Zero refund (full deduction) and full refund -------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select public.propose_return(:'a3', pg_temp.ist(21, '17:00'), '', 0) as p_a3 \gset
select set_config('request.jwt.claims', :'ca', true) \gset ignored_
select public.accept_return(:'p_a3') \gset ignored_
select set_config('request.jwt.claims', :'cp', true) \gset ignored_
select pg_temp.expect_error(format($$select public.prepare_return(%L, 'Broken leg', 1000, '', 'upi')$$, :'a3'), 'deduction_reason_required', 'keeping the whole deposit needs a reason');
select public.prepare_return(:'a3', 'Broken leg', 1000, 'Leg snapped; repair costs more than the deposit', 'upi') as r_a3 \gset
select pg_temp.expect((select refund_due = 0 and payment_method = 'none' from public.booking_exchanges where id = :'r_a3'), 'zero refund: method recorded as none');
select pg_temp.expect_error(format($$select public.confirm_return(%L, 1, 1000, 0, array['received_item','condition_matches'])$$, :'r_a3'), 'acknowledgements_required', 'a zero refund still needs every acknowledgement');
select public.confirm_return(:'r_a3', 1, 1000, 0, array['received_item','condition_matches','refund_paid']) \gset ignored_
select set_config('request.jwt.claims', :'ca', true) \gset ignored_
select pg_temp.expect(public.confirm_return(:'r_a3', 1, 1000, 0, array['returned_item','settlement_agreed','refund_received']) = 'returned', 'a zero-refund settlement completes when both agree');

select public.propose_return(:'a4', pg_temp.ist(31, '11:00'), '', 0) as p_a4 \gset
select set_config('request.jwt.claims', :'cp', true) \gset ignored_
select public.accept_return(:'p_a4') \gset ignored_
select public.prepare_return(:'a4', 'Same as handover', 0, 'ignored when nothing is deducted', 'bank_transfer') as r_a4 \gset
select pg_temp.expect((select refund_due = 1000 and deduction_amount = 0 and deduction_reason is null and payment_method = 'bank_transfer' from public.booking_exchanges where id = :'r_a4'), 'full refund: ₹1,000 by bank transfer, no deduction reason');
reset role;

-- Return evidence: participants may upload while the return is open.
select format('%s/%s/%s.webp', :'a4', :'r_a4', gen_random_uuid()) as epath, format('%s/%s/%s.webp', :'a1', :'r2', gen_random_uuid()) as epath_done \gset
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
insert into storage.objects (bucket_id, name, owner_id) values ('exchange-evidence', :'epath', :'ra');
select pg_temp.expect(true, 'a participant can upload a return photo while the return is open');
select pg_temp.expect_error(format($$insert into storage.objects (bucket_id, name, owner_id) values ('exchange-evidence', %L, %L)$$, :'epath_done', :'ra'), 'denied', 'no new photos after completion');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect((select count(*) = 0 from storage.objects where bucket_id = 'exchange-evidence' and name like :'a4' || '/%'), 'another renter cannot read return photos');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
reset role;
grant execute on function pg_temp.expect_error(text, text, text) to anon;
grant execute on function pg_temp.expect(boolean, text) to anon;
set local role anon;
select pg_temp.expect_error('select count(*) from public.booking_pickup_snapshots', 'denied', 'anonymous visitors cannot read pickup addresses at all');
select pg_temp.expect_error('select count(*) from public.return_proposals', 'denied', 'anonymous visitors cannot read return proposals');
select pg_temp.expect((select count(*) = 0 from storage.objects where bucket_id = 'exchange-evidence'), 'anonymous visitors read no evidence objects');
reset role;

-- Database invariants (as the owner) ------------------------------------------------
select pg_temp.expect_error(format($$update public.bookings set status = 'completed', phase = 'returned' where id = %L$$, :'a2'), 'invalid_phase_transition', 'even the owner cannot complete a booking that was never handed over');
select pg_temp.expect_error(format($$update public.bookings set phase = 'returned', status = 'completed' where id = %L$$, :'a4'), 'completion_requires_both_confirmations', 'even the owner cannot complete without both return confirmations');
select pg_temp.expect_error(format($$update public.bookings set phase = 'awaiting_handover' where id = %L$$, :'a4'), 'invalid_phase_transition', 'phases cannot move backwards');
select pg_temp.expect_error(
  format($$insert into public.booking_exchanges (booking_id, kind, revision, created_by, rent_amount, deposit_amount, payment_method, condition_notes, scheduled_at, deduction_amount) values (%L, 'return', 9, %L, 300, 1000, 'cash', 'Forged', now(), 1500)$$, :'a1', :'pp'),
  'check', 'a deduction above the deposit is impossible in the table');
select pg_temp.expect_error(format($$update public.return_proposals set proposed_at = now() where id = %L$$, :'p3'), 'proposal_immutable', 'an accepted proposal''s time cannot be rewritten');

-- Suspended participants -----------------------------------------------------------
update public.profiles set account_status = 'suspended' where id = :'ra';
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect_error(format($$select public.confirm_return(%L, 1, 0, 1000, array['returned_item','settlement_agreed','refund_received'])$$, :'r_a4'), 'account_not_active', 'a suspended renter cannot confirm a return');
reset role;
update public.profiles set account_status = 'active' where id = :'ra';

-- Late return: the scheduled return has passed while the rental is active.
insert into public.bookings (id, product_id, renter_id, provider_id, start_date, end_date, pickup_at, return_at, price_per_day, deposit, status, request_key)
select :'late', :'l1', :'rb', :'pp', d - 4, d - 2, ((d - 4)::text || ' 10:00+05:30')::timestamptz, ((d - 2)::text || ' 18:00+05:30')::timestamptz, 100, 1000, 'confirmed', gen_random_uuid()
from (select (now() at time zone 'Asia/Kolkata')::date as d) t;
insert into public.booking_exchanges (id, booking_id, kind, revision, created_by, rent_amount, deposit_amount, payment_method, condition_notes, scheduled_at)
select '92000000-0000-4000-a000-0000000000f1', :'late', 'handover', 1, :'pp', 300, 1000, 'cash', 'Good', pickup_at from public.bookings where id = :'late';
insert into public.exchange_confirmations (exchange_id, participant_id, participant_role, acknowledged) values
  ('92000000-0000-4000-a000-0000000000f1', :'pp', 'provider', '{}'), ('92000000-0000-4000-a000-0000000000f1', :'rb', 'renter', '{}');
update public.bookings set phase = 'active' where id = :'late';
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect_error(format($$select public.propose_return(%L, now() + interval '8 days', 'Next week', 0)$$, :'late'), 'late_return_too_far', 'an overdue rental cannot be pushed out by more than 7 days');
select public.propose_return(:'late', now() + interval '1 day', 'Sorry, returning tomorrow', 0) as p_late \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select public.accept_return(:'p_late') \gset ignored_
select public.prepare_return(:'late', 'Returned two days late, condition fine', 0, '', 'cash') as r_late \gset
select public.confirm_return(:'r_late', 1, 0, 1000, array['received_item','condition_matches','refund_paid']) \gset ignored_
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect(public.confirm_return(:'r_late', 1, 0, 1000, array['returned_item','settlement_agreed','refund_received']) = 'returned', 'a late return is recorded and completes by agreement');
reset role;
select pg_temp.expect((select end_date = (now() at time zone 'Asia/Kolkata')::date - 2 and return_at < now() and status = 'completed' from public.bookings where id = :'late'),
  'the late return does not extend the original reservation');

do $$ begin raise notice 'All Stage 9 boundary tests passed.'; end $$;
rollback;
