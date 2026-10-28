-- BorrowNest Stage 8: mutual handover boundary tests.
-- Runs as authenticated users with JWT claims, then rolls back.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stage8_handover.sql

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
    if (expected = 'denied' and sqlstate = '42501') or (expected = 'unique' and sqlstate = '23505')
       or sqlerrm = 'BN:' || expected then
      raise notice 'ok - %', description;
    else
      raise exception 'BOUNDARY TEST FAILED: % (got % %)', description, sqlstate, sqlerrm;
    end if;
end;
$$;
grant execute on function pg_temp.expect(boolean, text) to authenticated;
grant execute on function pg_temp.expect_error(text, text, text) to authenticated;

\set ra '80000000-0000-4000-a000-0000000000a1'
\set rb '80000000-0000-4000-a000-0000000000b1'
\set pp '80000000-0000-4000-a000-0000000000c1'
\set pq '80000000-0000-4000-a000-0000000000d1'
\set ad '80000000-0000-4000-a000-0000000000e1'
\set l1 '81000000-0000-4000-a000-000000000001'
\set l2 '81000000-0000-4000-a000-000000000002'
\set ex '82000000-0000-4000-a000-000000000001'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'ra', 'bn-test-h-renter-a@roldex.me', '{"full_name":"Asha Renter"}'),
  (:'rb', 'bn-test-h-renter-b@roldex.me', '{"full_name":"Bina Renter"}'),
  (:'pp', 'bn-test-h-provider-p@roldex.me', '{"full_name":"Prakash Provider","account_type":"provider"}'),
  (:'pq', 'bn-test-h-provider-q@roldex.me', '{"full_name":"Qadir Provider","account_type":"provider"}'),
  (:'ad', 'bn-test-h-admin@roldex.me', '{"full_name":"Admin"}');
update public.profiles set role = 'admin' where id = :'ad';
insert into public.products (id, provider_id, title, description, category, condition, price_per_day, deposit, area, listing_status) values
  (:'l1', :'pp', 'H8 sofa', 'A sofa for handover tests.', 'furniture', 'good', 100, 1000, 'Thatipur', 'published'),
  (:'l2', :'pp', 'H8 bicycle', 'A bicycle for handover tests.', 'bicycles', 'good', 50, 500, 'Lashkar', 'published');
insert into public.product_pickup_details (product_id, exact_address, pickup_instructions) values
  (:'l1', 'H8 sofa address', ''), (:'l2', 'H8 bike address', '');

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

-- Fixtures: A has a confirmed sofa booking (3 days: ₹300 + ₹1,000) and a
-- pending one; B has a confirmed bicycle booking.
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.req(:'l1', 5, 7) as a1 \gset
select pg_temp.req(:'l1', 20, 21) as apend \gset
select pg_temp.req(:'l1', 30, 31) as acanc \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.req(:'l2', 5, 6) as b1 \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select public.transition_booking(:'a1', 'confirm', '') \gset ignored_
select public.transition_booking(:'b1', 'confirm', '') \gset ignored_
select public.transition_booking(:'acanc', 'confirm', '') \gset ignored_
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select public.admin_cancel_booking(:'acanc', 'Provider withdrew the item before pickup', '') \gset ignored_
reset role;

-- Preparing a handover ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect_error(format($$select public.prepare_handover(%L, 'Looks fine', 'cash')$$, :'a1'), 'provider_prepares_handover', 'a renter cannot prepare the handover summary');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cq', true);
select pg_temp.expect_error(format($$select public.prepare_handover(%L, 'Looks fine', 'cash')$$, :'a1'), 'booking_not_found', 'a non-owner provider cannot prepare a handover');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect_error(format($$select public.prepare_handover(%L, 'Looks fine', 'cash')$$, :'apend'), 'handover_not_open', 'a pending request has no handover');
select pg_temp.expect_error(format($$select public.prepare_handover(%L, 'Looks fine', 'cash')$$, :'acanc'), 'handover_not_open', 'a cancelled booking has no handover');
select pg_temp.expect_error(format($$select public.prepare_handover(%L, 'Looks fine', 'paypal')$$, :'a1'), 'invalid_payment_method', 'only cash, UPI or bank transfer labels are accepted');
select pg_temp.expect_error(format($$select public.prepare_handover(%L, ' ', 'cash')$$, :'a1'), 'invalid_condition_notes', 'condition notes are required');
select pg_temp.expect_error(format($$select public.prepare_handover(%L, %L, 'cash')$$, :'a1', repeat('x', 1001)), 'invalid_condition_notes', 'condition notes are bounded');
select public.prepare_handover(:'a1', '<script>alert(1)</script> Small scratch on the left armrest', 'upi') as x1 \gset
select pg_temp.expect(
  (select revision = 1 and status = 'current' and rent_amount = 300 and deposit_amount = 1000 and payment_method = 'upi'
     and condition_notes = '<script>alert(1)</script> Small scratch on the left armrest' and created_by = :'pp'
   from public.booking_exchanges where id = :'x1'),
  'the provider prepares revision 1 with the booking''s saved amounts; notes are stored as plain text');
select pg_temp.expect_error(format($$select public.prepare_handover(%L, 'Again', 'cash')$$, :'a1'), 'handover_exists', 'a second handover cannot be prepared');
select public.prepare_handover(:'b1', 'Bicycle tyres pumped, minor rust on chain', 'cash') as xb \gset
-- No client writes.
select pg_temp.expect_error(format($$insert into public.booking_exchanges (booking_id, kind, revision, created_by, rent_amount, deposit_amount, payment_method, condition_notes, scheduled_at) values (%L, 'handover', 9, %L, 1, 1, 'cash', 'forged', now())$$, :'a1', :'pp'), 'denied', 'clients cannot insert exchange rows directly');
select pg_temp.expect_error(format($$insert into public.exchange_confirmations (exchange_id, participant_id, participant_role, acknowledged) values (%L, %L, 'renter', '{}')$$, :'x1', :'ra'), 'denied', 'a provider cannot forge a renter''s confirmation row');
select pg_temp.expect_error(format($$update public.booking_exchanges set rent_amount = 1 where id = %L$$, :'x1'), 'denied', 'clients cannot edit an exchange');
select pg_temp.expect_error(format($$delete from public.booking_exchanges where id = %L$$, :'x1'), 'denied', 'clients cannot delete an exchange');
select pg_temp.expect_error(format($$update public.bookings set phase = 'active' where id = %L$$, :'a1'), 'denied', 'clients cannot change the phase directly');
reset role;

-- Visibility -------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect((select count(*) = 1 from public.booking_exchanges), 'renter B sees only their own exchange');
select pg_temp.expect((select count(*) = 0 from public.booking_exchanges where id = :'x1'), 'renter B cannot read renter A''s exchange');
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 1, array['received_item','condition_agreed','paid_amounts'])$$, :'x1'), 'booking_not_found', 'renter B cannot confirm renter A''s handover');
select pg_temp.expect_error(format($$select public.revise_handover(%L, 1, 'Changed it', 'cash', 'Not my booking')$$, :'x1'), 'booking_not_found', 'renter B cannot revise renter A''s handover');
select pg_temp.expect_error(format($$select public.open_dispute(%L, 'other', 'Trying to hold someone else''s booking')$$, :'a1'), 'booking_not_found', 'renter B cannot flag renter A''s booking');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cq', true);
select pg_temp.expect((select count(*) = 0 from public.booking_exchanges), 'a non-owner provider sees no exchanges');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select pg_temp.expect((select count(*) = 1 from public.booking_exchanges where id = :'x1'), 'an admin can read the exchange');
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 1, array['received_item','condition_agreed','paid_amounts'])$$, :'x1'), 'booking_not_found', 'an admin cannot confirm as the renter');
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 1, array['handed_over_item','condition_matches','received_amounts'])$$, :'x1'), 'booking_not_found', 'an admin cannot confirm as the provider');
reset role;

-- Acknowledgements ---------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 1, array['received_item','condition_agreed'])$$, :'x1'), 'acknowledgements_required', 'every renter acknowledgement is required');
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 1, array['handed_over_item','condition_matches','received_amounts'])$$, :'x1'), 'acknowledgements_required', 'a renter cannot submit the provider''s checklist');
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 1, null)$$, :'x1'), 'acknowledgements_required', 'missing acknowledgements are refused');
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 2, array['received_item','condition_agreed','paid_amounts'])$$, :'x1'), 'stale_revision', 'a revision number that is not current is refused');
select pg_temp.expect(public.confirm_handover(:'x1', 1, array['paid_amounts','received_item','condition_agreed']) = 'awaiting_handover', 'the first confirmation waits for the other participant');
select pg_temp.expect(public.confirm_handover(:'x1', 1, array['received_item','condition_agreed','paid_amounts']) = 'awaiting_handover', 'repeating it is a no-op');
select pg_temp.expect((select count(*) = 1 from public.exchange_confirmations where exchange_id = :'x1'), 'only one confirmation row');
select pg_temp.expect((select count(*) = 1 from public.booking_events where booking_id = :'a1' and event_type = 'handover_confirmed'), 'only one confirmation event');
select pg_temp.expect((select participant_id = :'ra' and participant_role = 'renter' from public.exchange_confirmations where exchange_id = :'x1'), 'the database derived the participant and role from the session');

-- Correction --------------------------------------------------------------------
select pg_temp.expect_error(format($$select public.revise_handover(%L, 1, 'Small scratch', 'upi', '')$$, :'x1'), 'reason_required', 'a correction needs a reason');
select pg_temp.expect_error(format($$select public.revise_handover(%L, 1, %L, 'upi', 'Same again')$$, :'x1', '<script>alert(1)</script> Small scratch on the left armrest'), 'no_change', 'a correction must change something');
select pg_temp.expect_error(format($$select public.revise_handover(%L, 7, 'Two scratches', 'upi', 'Wrong revision')$$, :'x1'), 'stale_revision', 'a correction against an old revision number is refused');
select public.revise_handover(:'x1', 1, 'Two scratches on the left armrest, cushion stain', 'cash', 'I saw a second scratch and paid in cash') as x2 \gset
select pg_temp.expect((select status = 'superseded' and superseded_at is not null from public.booking_exchanges where id = :'x1'), 'the old revision is kept, marked superseded');
select pg_temp.expect(
  (select revision = 2 and status = 'current' and rent_amount = 300 and deposit_amount = 1000 and created_by = :'ra' and payment_method = 'cash'
     and scheduled_at = (select pickup_at from public.bookings where id = :'a1')
   from public.booking_exchanges where id = :'x2'),
  'the correction is revision 2, with the same amounts and scheduled time');
select pg_temp.expect((select count(*) = 0 from public.exchange_confirmations where exchange_id = :'x2'), 'confirmations of revision 1 do not carry over');
select pg_temp.expect_error(format($$select public.revise_handover(%L, 1, 'Third try', 'cash', 'Old revision')$$, :'x1'), 'stale_revision', 'the superseded revision cannot be corrected again');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 1, array['handed_over_item','condition_matches','received_amounts'])$$, :'x1'), 'stale_revision', 'the provider cannot confirm the superseded revision');
select pg_temp.expect((select phase = 'awaiting_handover' from public.bookings where id = :'a1'), 'a renter confirmation of revision 1 plus nothing on revision 2 does not activate');

-- Issue hold ------------------------------------------------------------------------
select pg_temp.expect_error(format($$select public.open_dispute(%L, 'lottery', 'This is a long enough description')$$, :'a1'), 'invalid_category', 'issue categories are fixed');
select pg_temp.expect_error(format($$select public.open_dispute(%L, 'payment', 'short')$$, :'a1'), 'invalid_description', 'an issue needs a description');
select public.open_dispute(:'a1', 'payment', 'Renter says UPI sent but nothing has arrived yet <b>x</b>') as issue \gset
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 2, array['handed_over_item','condition_matches','received_amounts'])$$, :'x2'), 'issue_open', 'an open issue blocks the provider''s confirmation');
select pg_temp.expect_error(format($$select public.admin_resolve_dispute(%L, 'no_action', 'I resolve my own issue', '', 0, 0, '', 'not_applicable')$$, :'issue'), 'not_active_admin', 'a participant cannot resolve an issue');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 2, array['received_item','condition_agreed','paid_amounts'])$$, :'x2'), 'issue_open', 'an open issue blocks the renter''s confirmation too');
select pg_temp.expect((select count(*) = 1 from public.booking_disputes where booking_id = :'a1' and status = 'open'), 'both participants can see the open issue');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select pg_temp.expect((select count(*) = 1 from public.admin_list_disputes(null, 20, 0) where id = :'issue'), 'the admin issue queue lists it');
select pg_temp.expect_error(format($$select public.admin_resolve_dispute(%L, 'no_action', 'short', '', 0, 0, '', 'not_applicable')$$, :'issue'), 'reason_required', 'resolving needs a written resolution');
select pg_temp.expect(admin_resolve_dispute(:'issue', 'no_action', 'Provider confirmed the UPI transfer arrived late', '', 0, 0, '', 'not_applicable') = 'resolved', 'an admin resolves the issue');
select pg_temp.expect(admin_resolve_dispute(:'issue', 'no_action', 'Provider confirmed the UPI transfer arrived late', '', 0, 0, '', 'not_applicable') = 'resolved', 'repeating the resolution is a no-op');
select pg_temp.expect((select count(*) = 1 from public.admin_audit_logs where target_id = :'a1' and action = 'dispute.resolve'), 'the resolution is audited once');
select pg_temp.expect((select count(*) = 1 from public.booking_events where booking_id = :'a1' and event_type = 'dispute_resolved'), 'exactly one resolution event');
reset role;

-- Dual confirmation ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect(public.confirm_handover(:'x2', 2, array['handed_over_item','condition_matches','received_amounts']) = 'awaiting_handover', 'the provider confirms revision 2 and waits for the renter');
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 2, array['received_item','condition_agreed','paid_amounts'])$$, :'x2'), 'acknowledgements_required', 'the provider cannot also confirm with the renter''s checklist');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect(public.confirm_handover(:'x2', 2, array['received_item','condition_agreed','paid_amounts']) = 'active', 'the second participant''s confirmation activates the rental');
select pg_temp.expect(public.confirm_handover(:'x2', 2, array['received_item','condition_agreed','paid_amounts']) = 'active', 'repeating after activation is a harmless no-op');
select pg_temp.expect((select phase = 'active' and status = 'confirmed' from public.bookings where id = :'a1'), 'the booking is active');
select pg_temp.expect((select count(*) = 1 from public.booking_events where booking_id = :'a1' and event_type = 'rental_activated'), 'exactly one activation event');
select pg_temp.expect((select count(*) = 3 from public.booking_events where booking_id = :'a1' and event_type = 'handover_confirmed'), 'three confirmation events in total (one superseded)');
select pg_temp.expect_error(format($$select public.revise_handover(%L, 2, 'Late change', 'cash', 'After activation')$$, :'x2'), 'handover_not_open', 'an active rental''s handover cannot be revised');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect(public.confirm_handover(:'x2', 2, array['handed_over_item','condition_matches','received_amounts']) = 'active', 'the provider repeating after activation is a no-op too');
select pg_temp.expect((select count(*) = 1 from public.booking_events where booking_id = :'a1' and event_type = 'rental_activated'), 'still exactly one activation event');
reset role;

-- Database invariants (as the owner, bypassing the functions) -----------------
select pg_temp.expect_error(
  format($$insert into public.booking_exchanges (booking_id, kind, revision, created_by, rent_amount, deposit_amount, payment_method, condition_notes, scheduled_at) values (%L, 'return', 1, %L, 1, 500, 'cash', 'Forged amount', now())$$, :'b1', :'pp'),
  'amount_mismatch', 'an exchange amount cannot differ from the booking');
select pg_temp.expect_error(format($$update public.booking_exchanges set condition_notes = 'rewritten' where id = %L$$, :'xb'), 'exchange_immutable', 'a revision''s content cannot be rewritten');
select pg_temp.expect_error(format($$update public.booking_exchanges set status = 'current' where id = %L$$, :'x1'), 'exchange_immutable', 'a superseded revision cannot be revived');
select pg_temp.expect_error(format($$update public.bookings set phase = 'active' where id = %L$$, :'b1'), 'activation_requires_both_confirmations', 'even the owner cannot activate without both confirmations');
select pg_temp.expect_error(format($$insert into public.booking_exchanges (booking_id, kind, revision, created_by, rent_amount, deposit_amount, payment_method, condition_notes, scheduled_at) values (%L, 'handover', 2, %L, 100, 500, 'cash', 'Second current revision', now())$$, :'b1', :'pp'), 'unique', 'only one current handover revision per booking');

-- Suspended participants -----------------------------------------------------------
update public.profiles set account_status = 'suspended' where id = :'rb';
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 1, array['received_item','condition_agreed','paid_amounts'])$$, :'xb'), 'account_not_active', 'a suspended renter cannot confirm');
select pg_temp.expect((select count(*) = 0 from public.booking_exchanges), 'a suspended renter loses exchange access');
reset role;
update public.profiles set account_status = 'active' where id = :'rb';
update public.profiles set account_status = 'suspended' where id = :'pp';
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect_error(format($$select public.confirm_handover(%L, 1, array['handed_over_item','condition_matches','received_amounts'])$$, :'xb'), 'account_not_active', 'a suspended provider cannot confirm');
reset role;
update public.profiles set account_status = 'active' where id = :'pp';

-- Expired handover: a confirmed booking whose return time has passed.
insert into public.bookings (id, product_id, renter_id, provider_id, start_date, end_date, pickup_at, return_at, price_per_day, deposit, status, request_key)
select :'ex', :'l2', :'rb', :'pp', d - 3, d - 2, ((d - 3)::text || ' 10:00+05:30')::timestamptz, ((d - 2)::text || ' 18:00+05:30')::timestamptz, 50, 500, 'confirmed', gen_random_uuid()
from (select (now() at time zone 'Asia/Kolkata')::date as d) t;
set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect_error(format($$select public.prepare_handover(%L, 'Late handover', 'cash')$$, :'ex'), 'handover_expired', 'a handover cannot start after the scheduled return time');
reset role;

-- Evidence storage -------------------------------------------------------------------
select pg_temp.expect((select not public and file_size_limit = 5242880 and allowed_mime_types = array['image/webp'] from storage.buckets where id = 'exchange-evidence'),
  'the evidence bucket is private, 5 MB, WebP only');
select format('%s/%s/%s.webp', :'b1', :'xb', gen_random_uuid()) as epath, format('%s/%s/%s.webp', :'b1', :'xb', gen_random_uuid()) as epath2,
       format('%s/%s/%s.webp', :'a1', :'x2', gen_random_uuid()) as epath_active \gset

set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect_error(format($$insert into storage.objects (bucket_id, name, owner_id) values ('exchange-evidence', %L, %L)$$, :'epath', :'ra'), 'denied', 'a non-participant cannot upload evidence to another booking');
select pg_temp.expect_error(format($$insert into storage.objects (bucket_id, name, owner_id) values ('exchange-evidence', %L, %L)$$, :'epath_active', :'ra'), 'denied', 'evidence cannot be added once the rental is active');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
insert into storage.objects (bucket_id, name, owner_id) values ('exchange-evidence', :'epath', :'rb');
insert into storage.objects (bucket_id, name, owner_id) values ('exchange-evidence', :'epath2', :'rb');
select pg_temp.expect_error(format($$insert into storage.objects (bucket_id, name, owner_id) values ('exchange-evidence', %L, %L)$$, :'b1' || '/' || :'xb' || '/evil.svg', :'rb'), 'denied', 'evidence object names must be <booking>/<exchange>/<uuid>.webp');
-- No update or delete policy: RLS silently matches nothing.
update storage.objects set name = name || '.png' where name = :'epath';
reset role;
select pg_temp.expect((select count(*) = 1 from storage.objects where name = :'epath'), 'uploaded evidence cannot be renamed by participants (no update policy; deletes go only through the Storage API, which has no delete policy)');
set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
reset role;

select encode(extensions.hmac('evidence:v1:' || :'rb' || ':' || :'xb' || ':' || :'epath', private.image_attestation_key(), 'sha256'), 'hex') as sig,
       encode(extensions.hmac('evidence:v1:' || :'pp' || ':' || :'xb' || ':' || :'epath2', private.image_attestation_key(), 'sha256'), 'hex') as sig_wrong_user \gset

set local role authenticated;
select set_config('request.jwt.claims', :'cb', true);
select pg_temp.expect_error(format($$select public.attach_exchange_evidence(%L, %L, 'Front', 'forged')$$, :'xb', :'epath'), 'invalid_image_signature', 'evidence needs the server''s image signature');
select pg_temp.expect_error(format($$select public.attach_exchange_evidence(%L, %L, 'Front', %L)$$, :'xb', :'epath2', :'sig_wrong_user'), 'invalid_image_signature', 'a signature made for another user is refused');
select public.attach_exchange_evidence(:'xb', :'epath', '<img src=x> Front wheel', :'sig') as ev \gset
select pg_temp.expect((select caption = '<img src=x> Front wheel' and uploaded_by = :'rb' from public.exchange_evidence where id = :'ev'), 'the participant attaches signed evidence; caption is plain text');
select pg_temp.expect_error(format($$select public.attach_exchange_evidence(%L, %L, 'Again', %L)$$, :'xb', :'epath', :'sig'), 'image_already_used', 'the same object cannot be attached twice');
select pg_temp.expect((select count(*) = 2 from storage.objects where bucket_id = 'exchange-evidence' and name like :'b1' || '/%'), 'the participant can read their evidence objects');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'cp', true);
select pg_temp.expect((select count(*) = 1 from public.exchange_evidence where id = :'ev'), 'the other participant sees the evidence');
select pg_temp.expect((select count(*) = 2 from storage.objects where bucket_id = 'exchange-evidence' and name like :'b1' || '/%'), 'the other participant can read the evidence objects');
select public.revise_handover(:'xb', 1, 'Bicycle tyres pumped, rust on chain and a bent mudguard', 'cash', 'Noticed the mudguard') as xb2 \gset
select pg_temp.expect((select count(*) = 1 from public.exchange_evidence where exchange_id = :'xb2' and storage_path = :'epath'), 'evidence stays visible on the corrected revision');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'ca', true);
select pg_temp.expect((select count(*) = 0 from public.exchange_evidence where exchange_id in (:'xb', :'xb2')), 'renter A cannot list B''s evidence rows');
select pg_temp.expect((select count(*) = 0 from storage.objects where bucket_id = 'exchange-evidence' and name like :'b1' || '/%'), 'renter A cannot read B''s evidence objects');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cq', true);
select pg_temp.expect((select count(*) = 0 from storage.objects where bucket_id = 'exchange-evidence'), 'a non-owner provider reads no evidence objects');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect((select count(*) = 0 from storage.objects where bucket_id = 'exchange-evidence'), 'anonymous visitors read no evidence objects');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'cad', true);
select pg_temp.expect((select count(*) = 2 from storage.objects where bucket_id = 'exchange-evidence' and name like :'b1' || '/%'), 'an admin can read evidence objects');
reset role;

do $$ begin raise notice 'All Stage 8 boundary tests passed.'; end $$;
rollback;
