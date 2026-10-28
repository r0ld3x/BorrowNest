-- BorrowNest Stage 10: disputes and administrative resolution boundary tests.
-- Runs as authenticated users with JWT claims, then rolls back.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stage10_disputes.sql

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
    if (expected = 'denied' and sqlstate = '42501') or (expected = 'exclusion' and sqlstate = '23P01') or sqlerrm = 'BN:' || expected then
      raise notice 'ok - %', description;
    else
      raise exception 'BOUNDARY TEST FAILED: % (got % %)', description, sqlstate, sqlerrm;
    end if;
end;
$$;
grant execute on function pg_temp.expect(boolean, text) to authenticated, anon;
grant execute on function pg_temp.expect_error(text, text, text) to authenticated, anon;

\set ra 'a0000000-0000-4000-a000-0000000000a1'
\set rb 'a0000000-0000-4000-a000-0000000000b1'
\set pp 'a0000000-0000-4000-a000-0000000000c1'
\set pq 'a0000000-0000-4000-a000-0000000000d1'
\set ad 'a0000000-0000-4000-a000-0000000000e1'
\set l1 'a1000000-0000-4000-a000-000000000001'
\set l2 'a1000000-0000-4000-a000-000000000002'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ra', 'bn-test-d-renter-a@roldex.me', '{"full_name":"Asha Renter"}'),
  (:'rb', 'bn-test-d-renter-b@roldex.me', '{"full_name":"Bina Renter"}'),
  (:'pp', 'bn-test-d-provider-p@roldex.me', '{"full_name":"Prakash Provider","account_type":"provider"}'),
  (:'pq', 'bn-test-d-provider-q@roldex.me', '{"full_name":"Qadir Provider","account_type":"provider"}'),
  (:'ad', 'bn-test-d-admin@roldex.me', '{"full_name":"Admin"}');
update public.profiles set role = 'admin' where id = :'ad';
insert into public.products (id, provider_id, title, description, category, condition, price_per_day, deposit, area, listing_status) values
  (:'l1', :'pp', 'D10 sofa', 'A sofa for dispute tests.', 'furniture', 'good', 100, 1000, 'Thatipur', 'published'),
  (:'l2', :'pp', 'D10 bicycle', 'A bicycle for dispute tests.', 'bicycles', 'good', 50, 500, 'Lashkar', 'published');
insert into public.product_pickup_details (product_id, exact_address, pickup_instructions) values
  (:'l1', 'D10 secret sofa address', ''), (:'l2', 'D10 secret bike address', '');

select format('{"sub":"%s","role":"authenticated"}', :'ra') as ca, format('{"sub":"%s","role":"authenticated"}', :'rb') as cb,
       format('{"sub":"%s","role":"authenticated"}', :'pp') as cp, format('{"sub":"%s","role":"authenticated"}', :'pq') as cq,
       format('{"sub":"%s","role":"authenticated"}', :'ad') as cad \gset

create function pg_temp.as_(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', who), true) $$;
create function pg_temp.ist(days integer, hhmm text) returns timestamptz language sql as $$
  select ((((now() at time zone 'Asia/Kolkata')::date + days)::text) || ' ' || hhmm || '+05:30')::timestamptz $$;
-- stage: 'confirmed' | 'handover_half' (renter confirmed handover) | 'active' | 'return_ready' (return summary shared)
create function pg_temp.rental(product uuid, s integer, e integer, stage text) returns uuid language plpgsql as $$
declare b uuid; x uuid; p uuid;
begin
  perform pg_temp.as_('a0000000-0000-4000-a000-0000000000a1');
  b := public.create_booking(product, (now() at time zone 'Asia/Kolkata')::date + s, (now() at time zone 'Asia/Kolkata')::date + e,
    pg_temp.ist(s, '10:00'), pg_temp.ist(e, '18:00'), '', gen_random_uuid());
  perform pg_temp.as_('a0000000-0000-4000-a000-0000000000c1');
  perform public.transition_booking(b, 'confirm', '');
  if stage = 'confirmed' then return b; end if;
  x := public.prepare_handover(b, 'Good condition', 'cash');
  perform pg_temp.as_('a0000000-0000-4000-a000-0000000000a1');
  perform public.confirm_handover(x, 1, array['received_item','condition_agreed','paid_amounts']);
  if stage = 'handover_half' then return b; end if;
  perform pg_temp.as_('a0000000-0000-4000-a000-0000000000c1');
  perform public.confirm_handover(x, 1, array['handed_over_item','condition_matches','received_amounts']);
  if stage = 'active' then return b; end if;
  p := public.propose_return(b, pg_temp.ist(e, '12:00'), '', 0);
  perform pg_temp.as_('a0000000-0000-4000-a000-0000000000a1');
  perform public.accept_return(p);
  perform pg_temp.as_('a0000000-0000-4000-a000-0000000000c1');
  perform public.prepare_return(b, 'Returned fine', 100, 'Cleaning fee', 'upi');
  return b;
end $$;
grant execute on function pg_temp.as_(uuid) to authenticated;
grant execute on function pg_temp.ist(integer, text) to authenticated;
grant execute on function pg_temp.rental(uuid, integer, integer, text) to authenticated;

set local role authenticated;
select pg_temp.rental(:'l1', 5, 7, 'return_ready') as a1, pg_temp.rental(:'l1', 10, 12, 'active') as a2,
       pg_temp.rental(:'l1', 20, 21, 'handover_half') as h1, pg_temp.rental(:'l2', 5, 6, 'confirmed') as c1 \gset
select pg_temp.as_(:'ra') \gset ignored_
select public.create_booking(:'l2', (now() at time zone 'Asia/Kolkata')::date + 30, (now() at time zone 'Asia/Kolkata')::date + 31,
  pg_temp.ist(30, '10:00'), pg_temp.ist(31, '18:00'), '', gen_random_uuid()) as apend \gset
reset role;
select (select id from public.booking_exchanges where booking_id = :'a1' and kind = 'return' and status = 'current') as r1,
       (select id from public.booking_exchanges where booking_id = :'h1' and kind = 'handover' and status = 'current') as hx \gset

-- Opening disputes --------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect_error(format($$select public.open_dispute(%L, 'condition', 'Not my booking at all, testing')$$, :'a1'), 'booking_not_found', 'an unrelated renter cannot open a dispute (same error as a missing booking)');
select pg_temp.expect_error($$select public.open_dispute('00000000-0000-4000-a000-000000000000', 'condition', 'Guessing booking ids here')$$, 'booking_not_found', 'a made-up booking id gives the same error');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cq', true);
select pg_temp.expect_error(format($$select public.open_dispute(%L, 'condition', 'Not my listing, testing this')$$, :'a1'), 'booking_not_found', 'an unrelated provider cannot open a dispute');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect_error(format($$select public.open_dispute(%L, 'condition', 'Pending request dispute test')$$, :'apend'), 'booking_not_disputable', 'a pending request cannot be disputed');
select pg_temp.expect_error(format($$select public.open_dispute(%L, 'lottery', 'Unknown category test here')$$, :'a1'), 'invalid_category', 'categories are fixed');
select pg_temp.expect_error(format($$select public.open_dispute(%L, 'refund', 'short')$$, :'a1'), 'invalid_description', 'a dispute needs an explanation');
select public.open_dispute(:'a1', 'refund', '<img src=x onerror=alert(1)> The ₹100 cleaning fee was never agreed') as d1 \gset
select pg_temp.expect(
  (select status = 'open' and opened_by = :'ra' and opened_by_role = 'renter' and phase_at_open = 'return_requested' and not post_completion
     and description = '<img src=x onerror=alert(1)> The ₹100 cleaning fee was never agreed' from public.booking_disputes where id = :'d1'),
  'the renter opens a refund dispute; actor and role come from the session; text stored as plain text');
select pg_temp.expect((select count(*) = 1 from public.booking_events where booking_id = :'a1' and event_type = 'dispute_opened'), 'opening records one event');
select pg_temp.expect_error(format($$insert into public.booking_disputes (booking_id, opened_by, opened_by_role, category, description) values (%L, %L, 'provider', 'other', 'Forged as the provider')$$, :'a1', :'pp'), 'denied', 'clients cannot insert disputes as someone else');
select pg_temp.expect_error(format($$update public.booking_disputes set status = 'resolved' where id = %L$$, :'d1'), 'denied', 'a participant cannot change a dispute''s status');
select pg_temp.expect_error(format($$select public.admin_resolve_dispute(%L, 'renter_favoured', 'I decide in my own favour', '', 0, 0, '', 'with_renter')$$, :'d1'), 'not_active_admin', 'a participant cannot resolve a dispute');
select pg_temp.expect_error(format($$select public.admin_set_dispute_status(%L, 'in_review', '')$$, :'d1'), 'not_active_admin', 'a participant cannot set review status');
select pg_temp.expect_error(format($$select public.admin_open_dispute_for(%L, 'provider', 'other', 'Pretending to be support')$$, :'a1'), 'not_active_admin', 'a participant cannot open disputes as support');
select pg_temp.expect_error($$select * from public.admin_list_disputes(null, 20, 0)$$, 'not_active_admin', 'a participant cannot list the dispute queue');
select pg_temp.expect_error(format($$select public.admin_release_inventory_hold(%L, 'Releasing my own hold')$$, :'l1'), 'not_active_admin', 'a participant cannot release an inventory hold');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select public.open_dispute(:'a1', 'condition', 'The sofa has a new tear on the left arm') as d2 \gset
select pg_temp.expect((select count(*) = 2 from public.booking_disputes where booking_id = :'a1'), 'the provider sees both disputes on their booking');
reset role;

-- Messages -----------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select public.add_dispute_message(:'d2', 'The tear was there at pickup; see the handover photo') as m_a \gset
select pg_temp.expect((select author_id = :'ra' and author_role = 'renter' and kind = 'statement' from public.dispute_messages where id = :'m_a'), 'the renter adds a statement to the provider''s dispute');
select pg_temp.expect_error(format($$select public.add_dispute_message(%L, ' ')$$, :'d2'), 'invalid_message', 'empty statements are refused');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select public.add_dispute_message(:'d2', 'It was not there; my handover notes say good condition') as m_p \gset
select pg_temp.expect_error(format($$update public.dispute_messages set body = 'I agree it was there' where id = %L$$, :'m_a'), 'denied', 'the provider cannot edit the renter''s statement');
select pg_temp.expect_error(format($$delete from public.dispute_messages where id = %L$$, :'m_a'), 'denied', 'the provider cannot delete the renter''s statement');
select pg_temp.expect_error(format($$insert into public.dispute_messages (dispute_id, author_id, author_role, kind, body) values (%L, %L, 'renter', 'statement', 'Forged renter statement')$$, :'d2', :'ra'), 'denied', 'the provider cannot post as the renter');
select pg_temp.expect_error(format($$delete from public.exchange_confirmations where exchange_id = %L$$, :'r1'), 'denied', 'existing confirmations cannot be deleted');
reset role;
select pg_temp.expect_error(format($$update public.dispute_messages set body = 'rewritten' where id = %L$$, :'m_a'), 'record_immutable', 'even the owner cannot rewrite a statement');

set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect((select count(*) = 0 from public.booking_disputes), 'an unrelated renter sees no disputes');
select pg_temp.expect((select count(*) = 0 from public.dispute_messages), 'an unrelated renter sees no dispute messages');
select pg_temp.expect_error(format($$select public.add_dispute_message(%L, 'Butting in')$$, :'d2'), 'booking_not_found', 'an unrelated renter cannot post to a dispute');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cq', true);
select pg_temp.expect((select count(*) = 0 from public.booking_disputes) and (select count(*) = 0 from public.dispute_messages), 'an unrelated provider sees no disputes or messages');
reset role;
set local role anon;
select pg_temp.expect_error('select count(*) from public.booking_disputes', 'denied', 'anonymous visitors cannot query disputes');
select pg_temp.expect_error('select count(*) from public.dispute_messages', 'denied', 'anonymous visitors cannot query dispute messages');
reset role;

-- Holds --------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect_error(format($$select public.confirm_return(%L, 1, 100, 900, array['returned_item','settlement_agreed','refund_received'])$$, :'r1'), 'issue_open', 'an open dispute blocks return confirmation');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select public.open_dispute(:'h1', 'handover', 'Renter has not paid the deposit yet') as dh \gset
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 1, array['handed_over_item','condition_matches','received_amounts'])$$, :'hx'), 'issue_open', 'an open dispute blocks the second handover confirmation');
reset role;
-- Direct writes cannot skip the hold either (both confirmations are inserted as the owner).
insert into public.exchange_confirmations (exchange_id, participant_id, participant_role, acknowledged) values (:'hx', :'pp', 'provider', '{}');
select pg_temp.expect_error(format($$update public.bookings set phase = 'active' where id = %L$$, :'h1'), 'issue_open', 'even the owner cannot activate a held booking');
insert into public.exchange_confirmations (exchange_id, participant_id, participant_role, acknowledged) values (:'r1', :'pp', 'provider', '{}'), (:'r1', :'ra', 'renter', '{}');
select pg_temp.expect_error(format($$update public.bookings set phase = 'returned', status = 'completed' where id = %L$$, :'a1'), 'issue_open', 'even the owner cannot complete a held booking');
delete from public.exchange_confirmations where exchange_id in (:'hx', :'r1') and acknowledged = '{}';

-- Admin review ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select pg_temp.expect((select count(*) = 3 from public.admin_list_disputes(null, 50, 0) where booking_id in (:'a1', :'h1')), 'the admin queue lists the three open disputes');
select pg_temp.expect((select count(*) = 1 and min(total_count) >= 3 from public.admin_list_disputes(null, 1, 0)), 'the queue is paginated (one row, full total)');
select pg_temp.expect((select count(*) = 1 from public.admin_list_disputes(null, 0, 0)), 'a zero page size is clamped to one');
select pg_temp.expect_error($$select * from public.admin_list_disputes('bogus', 20, 0)$$, 'invalid_status', 'unknown queue filters are refused');
select pg_temp.expect_error(format($$select public.admin_set_dispute_status(%L, 'needs_info', '')$$, :'d2'), 'note_required', 'asking for information needs a note');
select pg_temp.expect(public.admin_set_dispute_status(:'d2', 'needs_info', 'Please both upload a photo of the left arm') = 'needs_info', 'the admin asks for more information in-app');
select pg_temp.expect((select count(*) = 1 from public.dispute_messages where dispute_id = :'d2' and kind = 'info_request' and author_role = 'admin'), 'the request is recorded as an admin message');
select pg_temp.expect(public.admin_set_dispute_status(:'d1', 'in_review', '') = 'in_review', 'the admin marks the refund dispute in review');
select pg_temp.expect_error(format($$select public.admin_resolve_dispute(%L, 'whatever', 'A long enough reason', '', 0, 0, '', 'with_renter')$$, :'d1'), 'invalid_decision', 'decisions are fixed');
select pg_temp.expect_error(format($$select public.admin_resolve_dispute(%L, 'renter_favoured', 'short', '', 0, 0, '', 'with_renter')$$, :'d1'), 'reason_required', 'a resolution needs a reason');
select pg_temp.expect_error(format($$select public.admin_resolve_dispute(%L, 'renter_favoured', 'A long enough reason', '', -1, 0, '', 'with_renter')$$, :'d1'), 'invalid_amount', 'owed amounts cannot be negative');
select pg_temp.expect_error(format($$select public.admin_resolve_dispute(%L, 'renter_favoured', 'A long enough reason', '', 0.001, 0, '', 'with_renter')$$, :'d1'), 'invalid_amount', 'owed amounts are whole paise');
select pg_temp.expect_error(format($$select public.admin_resolve_dispute(%L, 'renter_favoured', 'A long enough reason', '', 0, 0, '', 'not_applicable')$$, :'d1'), 'possession_required', 'while the item may be with the renter, possession must be stated');
select pg_temp.expect(
  public.admin_resolve_dispute(:'d1', 'renter_favoured', 'No cleaning fee was agreed at pickup <script>x</script>', 'Handover notes mention no stains',
                               100, 0, 'Provider owes ₹100 back if already deducted', 'with_renter') = 'resolved',
  'the admin resolves the refund dispute in the renter''s favour');
select pg_temp.expect(
  public.admin_resolve_dispute(:'d1', 'renter_favoured', 'No cleaning fee was agreed at pickup <script>x</script>', '', 100, 0, '', 'with_renter') = 'resolved',
  'retrying the resolution is a no-op');
select pg_temp.expect((select count(*) = 1 from public.dispute_resolutions where dispute_id = :'d1'), 'exactly one resolution record');
select pg_temp.expect((select count(*) = 1 from public.admin_audit_logs where target_id = :'a1' and action = 'dispute.resolve'), 'the resolution is audited once despite the retry');
select pg_temp.expect_error(format($$select public.admin_set_dispute_status(%L, 'in_review', '')$$, :'d1'), 'dispute_resolved', 'a resolved dispute cannot be reopened');
reset role;
select pg_temp.expect_error(format($$update public.dispute_resolutions set decision = 'provider_favoured' where dispute_id = %L$$, :'d1'), 'record_immutable', 'a resolution cannot be rewritten, even by the owner');
select pg_temp.expect_error(format($$delete from public.dispute_resolutions where dispute_id = %L$$, :'d1'), 'record_immutable', 'a resolution cannot be deleted');
select pg_temp.expect_error(format($$update public.booking_disputes set status = 'open' where id = %L$$, :'d1'), 'record_immutable', 'a resolved dispute stays resolved');

set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect((select decision = 'renter_favoured' and provider_owes_renter = 100 from public.dispute_resolutions where dispute_id = :'d1'), 'the renter can read the admin''s decision and the amount owed');
select pg_temp.expect_error(format($$select public.add_dispute_message(%L, 'Thanks!')$$, :'d1'), 'dispute_resolved', 'no new statements on a resolved dispute');
select pg_temp.expect_error(format($$select public.confirm_return(%L, 1, 100, 900, array['returned_item','settlement_agreed','refund_received'])$$, :'r1'), 'issue_open', 'one resolved dispute does not lift the hold while another is open');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select public.admin_resolve_dispute(:'d2', 'no_action', 'Photos show the tear predates the rental', '', 0, 0, '', 'with_renter') \gset ignored_
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect(public.confirm_return(:'r1', 1, 100, 900, array['returned_item','settlement_agreed','refund_received']) = 'return_requested', 'with every dispute resolved, confirmation works again');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect(public.confirm_return(:'r1', 1, 100, 900, array['received_item','condition_matches','refund_paid']) = 'returned', 'both confirm: completed by mutual agreement');
reset role;
select pg_temp.expect(
  (select count(*) = 1 from public.dispute_resolutions r join public.booking_disputes d on d.id = r.dispute_id where d.booking_id = :'a1' and r.provider_owes_renter = 100)
  and not exists (select 1 from information_schema.columns where table_name = 'dispute_resolutions' and column_name ilike '%paid%'),
  'the ₹100 the admin said is owed stays a recorded obligation; nothing marks it paid');

-- Post-completion support window ----------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select public.open_dispute(:'a1', 'refund', 'Provider still has not returned the ₹100') as d_post \gset
select pg_temp.expect((select post_completion from public.booking_disputes where id = :'d_post') and (select status = 'completed' from public.bookings where id = :'a1'),
  'after completion a dispute is a support case; the completed booking is not reopened');
reset role;
alter table public.booking_events disable trigger user;
update public.booking_events set created_at = now() - interval '15 days' where booking_id = :'a1' and event_type = 'rental_completed';
alter table public.booking_events enable trigger user;
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect_error(format($$select public.open_dispute(%L, 'refund', 'Much later complaint here')$$, :'a1'), 'dispute_window_closed', 'the post-completion window is 14 days');
reset role;

-- Suspended participant and administrative closure ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select public.open_dispute(:'a2', 'return', 'Renter stopped answering and has not returned the sofa') as d_lost \gset
reset role;
update public.profiles set account_status = 'suspended' where id = :'ra';
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect_error(format($$select public.open_dispute(%L, 'other', 'Suspended renter trying')$$, :'a2'), 'account_not_active', 'a suspended renter cannot open disputes');
select pg_temp.expect_error(format($$select public.add_dispute_message(%L, 'Suspended renter reply')$$, :'d_lost'), 'account_not_active', 'a suspended renter cannot post');
select pg_temp.expect((select count(*) = 0 from public.booking_disputes), 'a suspended renter regains no read access');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select public.admin_open_dispute_for(:'a2', 'renter', 'other', 'Renter phoned support: the sofa was stolen from their flat') as d_behalf \gset
select pg_temp.expect((select opened_by = :'ad' and opened_by_role = 'admin' and on_behalf_of = 'renter' from public.booking_disputes where id = :'d_behalf'), 'support opens a dispute on behalf of the suspended renter, recorded as support');
select pg_temp.expect((select count(*) = 1 from public.admin_audit_logs where target_id = :'a2' and action = 'dispute.open_on_behalf'), 'opening on behalf is audited');
select pg_temp.expect_error(format($$select public.admin_resolve_dispute(%L, 'admin_closure', 'Item reported stolen by the renter', '', 0, 1000, '', 'lost')$$, :'d_lost'), 'other_disputes_open', 'closure requires every other dispute on the booking to be resolved');
select public.admin_resolve_dispute(:'d_behalf', 'no_action', 'Recorded the renter''s report; handled with the provider''s case', '', 0, 0, '', 'with_renter') \gset ignored_
select pg_temp.expect_error(format($$select public.admin_resolve_dispute(%L, 'admin_closure', 'Closing while the item is still out', '', 0, 0, '', 'with_renter')$$, :'d_lost'), 'possession_unresolved', 'a booking cannot be closed while the item is still with the renter');
select pg_temp.expect_error(format($$select public.admin_resolve_dispute(%L, 'admin_closure', 'Closing a booking never handed over', '', 0, 0, '', 'returned_to_provider')$$, :'dh'), 'closure_not_applicable', 'closure applies only to rentals in progress');
select pg_temp.expect(
  public.admin_resolve_dispute(:'d_lost', 'admin_closure', 'Sofa reported stolen; police report seen by support', 'Renter reported theft on day 11',
                               0, 1000, 'Renter owes the ₹1,000 deposit equivalent; provider keeps the deposit already held', 'lost') = 'closed',
  'the admin closes the booking: item lost, renter owes ₹1,000');
select pg_temp.expect(public.admin_resolve_dispute(:'d_lost', 'admin_closure', 'Sofa reported stolen; police report seen by support', '', 0, 1000, '', 'lost') = 'closed', 'retrying the closure is a no-op');
select pg_temp.expect((select count(*) = 1 from public.admin_closures where booking_id = :'a2') and (select count(*) = 1 from public.admin_audit_logs where target_id = :'a2' and action = 'booking.admin_close'),
  'exactly one closure record and one closure audit entry');
reset role;
select pg_temp.expect(
  (select b.status = 'closed' and b.phase = 'active' and c.possession_outcome = 'lost' and c.renter_owes_provider_outstanding = 1000
   from public.bookings b join public.admin_closures c on c.booking_id = b.id where b.id = :'a2'),
  'closed (not completed): phase history kept, ₹1,000 recorded as outstanding');
select pg_temp.expect(not exists (select 1 from public.exchange_confirmations c join public.booking_exchanges x on x.id = c.exchange_id where x.booking_id = :'a2' and x.kind = 'return'),
  'no return confirmation was made for anyone');
select pg_temp.expect((select inventory_hold = 'lost' and listing_status = 'paused' from public.products where id = :'l1'), 'the lost item''s listing is paused with an inventory hold');
select pg_temp.expect((select count(*) = 1 from public.admin_audit_logs where target_id = :'l1' and action = 'listing.inventory_hold'), 'the inventory hold is audited');
select pg_temp.expect(
  (select count(*) = 3 from public.bookings b, generate_series(b.start_date, b.end_date, interval '1 day') d where b.id = :'a2')
  and exists (select 1 from public.bookings where product_id = :'l1' and status = 'closed'),
  'the closed booking keeps its reserved dates');
select pg_temp.expect_error(format($$insert into public.bookings (product_id, renter_id, provider_id, start_date, end_date, pickup_at, return_at, price_per_day, deposit, status, request_key) select %L, %L, %L, start_date, end_date, pickup_at, return_at, 100, 1000, 'confirmed', gen_random_uuid() from public.bookings where id = %L$$, :'l1', :'rb', :'pp', :'a2'),
  'exclusion', 'no other booking can be reserved on the closed booking''s dates');
select pg_temp.expect_error(format($$update public.bookings set status = 'confirmed' where id = %L$$, :'a2'), 'booking_final', 'a closed booking cannot be reopened');
select pg_temp.expect_error(format($$update public.bookings set status = 'closed' where id = %L$$, :'c1'), 'closure_requires_record', 'a booking cannot be closed without a closure record');
update public.profiles set account_status = 'active' where id = :'ra';

set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect_error(format($$select public.resume_listing(%L)$$, :'l1'), 'inventory_hold', 'the provider cannot republish a listing whose item was lost');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select pg_temp.expect(public.admin_release_inventory_hold(:'l1', 'Provider replaced the sofa with an identical one') = 'released', 'an admin releases the hold with a reason');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect(public.resume_listing(:'l1') = 'published', 'after release the provider can republish');
reset role;

-- Private dispute evidence ----------------------------------------------------------------
select pg_temp.expect((select not public and allowed_mime_types = array['image/webp'] from storage.buckets where id = 'dispute-evidence'), 'the dispute evidence bucket is private and WebP only');
select format('%s/%s/%s.webp', :'h1', :'dh', gen_random_uuid()) as dpath, format('%s/%s/%s.webp', :'a1', :'d1', gen_random_uuid()) as dpath_resolved \gset
select encode(extensions.hmac('dispute:v1:' || :'pp' || ':' || :'dh' || ':' || :'dpath', private.image_attestation_key(), 'sha256'), 'hex') as dsig \gset
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect_error(format($$insert into storage.objects (bucket_id, name, owner_id) values ('dispute-evidence', %L, %L)$$, :'dpath', :'rb'), 'denied', 'an unrelated renter cannot upload dispute evidence');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
insert into storage.objects (bucket_id, name, owner_id) values ('dispute-evidence', :'dpath', :'pp');
select pg_temp.expect_error(format($$insert into storage.objects (bucket_id, name, owner_id) values ('dispute-evidence', %L, %L)$$, :'dpath_resolved', :'pp'), 'denied', 'no evidence on a resolved dispute');
select pg_temp.expect_error(format($$select public.attach_dispute_evidence(%L, %L, 'Receipt', 'forged')$$, :'dh', :'dpath'), 'invalid_image_signature', 'dispute evidence needs the server''s signature');
select public.attach_dispute_evidence(:'dh', :'dpath', '<b>UPI</b> screenshot', :'dsig') as dev \gset
select pg_temp.expect((select uploader_role = 'provider' and caption = '<b>UPI</b> screenshot' from public.dispute_evidence where id = :'dev'), 'the provider attaches signed evidence; caption is plain text');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect((select count(*) = 1 from storage.objects where bucket_id = 'dispute-evidence' and name = :'dpath'), 'the other participant can read the evidence');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cq', true);
select pg_temp.expect((select count(*) = 0 from storage.objects where bucket_id = 'dispute-evidence') and (select count(*) = 0 from public.dispute_evidence), 'an unrelated provider reads no dispute evidence');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select pg_temp.expect((select count(*) = 1 from storage.objects where bucket_id = 'dispute-evidence' and name = :'dpath'), 'an admin can read the evidence');
reset role;
set local role anon;
select pg_temp.expect((select count(*) = 0 from storage.objects where bucket_id = 'dispute-evidence'), 'anonymous visitors read no dispute evidence');
reset role;

-- Admin audit log cannot be rewritten.
select pg_temp.expect_error($$update public.admin_audit_logs set reason = 'rewritten' where action = 'dispute.resolve'$$, 'record_immutable', 'audit entries cannot be rewritten, even by the owner');
select pg_temp.expect_error($$delete from public.admin_audit_logs where action = 'dispute.resolve'$$, 'record_immutable', 'audit entries cannot be deleted, even by the owner');
set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select pg_temp.expect_error($$update public.admin_audit_logs set reason = 'rewritten'$$, 'denied', 'admins cannot rewrite audit entries');
reset role;

do $$ begin raise notice 'All Stage 10 boundary tests passed.'; end $$;
rollback;
