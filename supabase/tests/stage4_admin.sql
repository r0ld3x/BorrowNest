-- BorrowNest Stage 4: admin moderation, accounts, and audit boundary tests.
-- Runs as anon / authenticated roles with JWT claims, then rolls back.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stage4_admin.sql

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
    if (expected = 'denied' and sqlstate = '42501') or sqlerrm = 'BN:' || expected then
      raise notice 'ok - %', description;
    else
      raise exception 'BOUNDARY TEST FAILED: % (got % %)', description, sqlstate, sqlerrm;
    end if;
end;
$$;

grant execute on function pg_temp.expect(boolean, text) to anon, authenticated;
grant execute on function pg_temp.expect_error(text, text, text) to anon, authenticated;

-- Fixtures (operator privileges) ---------------------------------------------
\set a1 '40000000-0000-4000-a000-0000000000a1'
\set a2 '40000000-0000-4000-a000-0000000000a2'
\set p  '40000000-0000-4000-a000-0000000000b1'
\set q  '40000000-0000-4000-a000-0000000000b2'
\set r  '40000000-0000-4000-a000-0000000000c1'
\set l1 '41000000-0000-4000-a000-000000000001'
\set l2 '41000000-0000-4000-a000-000000000002'
\set l3 '41000000-0000-4000-a000-000000000003'
\set l4 '41000000-0000-4000-a000-000000000004'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'a1', 'bn-test-admin-1@roldex.me',    '{"full_name":"Admin One"}'),
  (:'a2', 'bn-test-admin-2@roldex.me',    '{"full_name":"Admin Two"}'),
  (:'p',  'bn-test-provider@roldex.me',   '{"full_name":"Provider P","account_type":"provider"}'),
  (:'q',  'bn-test-provider-2@roldex.me', '{"full_name":"Provider Q","account_type":"provider"}'),
  (:'r',  'bn-test-renter@roldex.me',     '{"full_name":"Renter R"}');
update public.profiles set role = 'admin' where id in (:'a1', :'a2');

-- l1, l2: complete and pending (P). l3: pending without a photo (Q). l4: P's draft.
insert into public.products (id, provider_id, title, description, category, condition, price_per_day, deposit, area, landmark, listing_status) values
  (:'l1', :'p', 'Stage4 study table',  'A wooden study table in good condition.',  'study_essentials', 'good', 55, 1200, 'City Centre', 'Near Jiwaji University', 'pending_review'),
  (:'l2', :'p', 'Stage4 bicycle',      'Geared bicycle, serviced and ready to ride.', 'bicycles', 'like_new', 60, 1500, 'Lashkar', 'Near Maharaj Bada', 'pending_review'),
  (:'l3', :'q', 'Stage4 no photo',     'A complete description but no photo yet.', 'kitchen', 'good', 40, 0, 'Morar', '', 'pending_review'),
  (:'l4', :'p', 'Stage4 draft 100%_x', 'Draft that is not submitted for review.',   'other', 'fair', 10, 0, 'Thatipur', '', 'draft');
insert into public.product_pickup_details (product_id, exact_address) values
  (:'l1', 'Test address one, not real'), (:'l2', 'Test address two, not real'),
  (:'l3', 'Test address three, not real'), (:'l4', 'Test address four, not real');
insert into public.product_images (product_id, storage_path, sort_order) values
  (:'l1', 'fixture/l1.webp', 0), (:'l2', 'fixture/l2.webp', 0), (:'l4', 'fixture/l4.webp', 0);

-- Expected counts measured as the operator, so tests hold on a database
-- that already contains real data.
select count(*) filter (where listing_status = 'pending_review') as exp_pending, count(*) as exp_total from public.products \gset
select updated_at as v1 from public.products where id = :'l1' \gset
select updated_at as v2 from public.products where id = :'l2' \gset
select updated_at as v3 from public.products where id = :'l3' \gset

-- Non-admins: every admin entry point is denied -------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect_error(format($$select public.moderate_listing(%L,'approve','',%L)$$, :'l1', :'v1'), 'denied', 'anon cannot call moderate_listing');
select pg_temp.expect_error($$select * from public.admin_overview()$$, 'denied', 'anon cannot read the admin overview');
select pg_temp.expect_error($$select * from public.admin_audit_logs$$, 'denied', 'anon cannot read the audit log');
reset role;

select format('{"sub":"%s","role":"authenticated"}', :'p') as claims_p \gset
select format('{"sub":"%s","role":"authenticated"}', :'r') as claims_r \gset
select format('{"sub":"%s","role":"authenticated"}', :'a1') as claims_a1 \gset
select format('{"sub":"%s","role":"authenticated"}', :'a2') as claims_a2 \gset

set local role authenticated;
select set_config('request.jwt.claims', :'claims_p', true);
select pg_temp.expect_error(format($$select public.moderate_listing(%L,'approve','',%L)$$, :'l1', :'v1'), 'not_active_admin', 'provider cannot approve their own listing via the admin function');
select pg_temp.expect_error(format($$select public.admin_edit_listing(%L,%L,'Title','','other','good','Area','','Some reason here')$$, :'l1', :'v1'), 'not_active_admin', 'provider cannot use admin_edit_listing');
select pg_temp.expect_error(format($$select public.suspend_account(%L,'Some reason here')$$, :'q'), 'not_active_admin', 'provider cannot suspend accounts');
select pg_temp.expect_error(format($$select public.restore_account(%L,'Some reason here')$$, :'p'), 'not_active_admin', 'provider cannot restore accounts');
select pg_temp.expect_error($$select * from public.admin_overview()$$, 'not_active_admin', 'provider cannot read the admin overview');
select pg_temp.expect_error($$select * from public.admin_list_listings(null,'',20,0)$$, 'not_active_admin', 'provider cannot list all listings');
select pg_temp.expect_error($$select * from public.admin_list_accounts('',20,0)$$, 'not_active_admin', 'provider cannot list accounts or emails');
select pg_temp.expect_error($$select * from public.admin_list_audit(null,20,0)$$, 'not_active_admin', 'provider cannot list the audit log');
select pg_temp.expect((select count(*) = 0 from public.admin_audit_logs), 'provider reads no audit rows directly');
select pg_temp.expect_error(format($$update public.products set listing_status='published', moderated_by=%L, moderated_at=now() where id=%L$$, :'p', :'l1'), 'denied', 'provider cannot set moderation status, actor or time directly');
select pg_temp.expect_error(format($$update public.products set moderation_reason='ok' where id=%L$$, :'l1'), 'denied', 'provider cannot write a moderation reason');
select pg_temp.expect_error(format($$insert into public.admin_audit_logs (actor_id, action, target_type, target_id) values (%L,'listing.approve','product',%L)$$, :'p', :'l1'), 'denied', 'provider cannot forge audit rows');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'claims_r', true);
select pg_temp.expect_error(format($$select public.moderate_listing(%L,'reject','Not allowed here',%L)$$, :'l1', :'v1'), 'not_active_admin', 'renter cannot reject listings');
select pg_temp.expect_error(format($$select public.suspend_account(%L,'Some reason here')$$, :'p'), 'not_active_admin', 'renter cannot suspend accounts');
reset role;

-- Admin: listing queue, search and pagination ---------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'claims_a1', true);

select pg_temp.expect((select pending_review = :exp_pending and total_listings = :exp_total from public.admin_overview()), 'overview counts real rows');
select pg_temp.expect((select count(*) = least(:exp_pending, 20) from public.admin_list_listings('pending_review','',20,0)), 'review queue lists every pending listing');
select pg_temp.expect((select bool_and(total_count = :exp_pending) from public.admin_list_listings('pending_review','',1,0)), 'total_count reports all matches while a page holds one');
select pg_temp.expect((select count(*) = 1 from public.admin_list_listings('pending_review','',0,0)), 'page size is clamped up to at least 1');
select pg_temp.expect((select count(*) <= 50 from public.admin_list_listings(null,'',100000,0)), 'page size is clamped to at most 50');
select pg_temp.expect((select count(*) = least(:exp_pending, 20) from public.admin_list_listings('pending_review','',20,-50)), 'negative offset is treated as 0');
select pg_temp.expect((select count(*) = 1 from public.admin_list_listings(null,'100%_x',20,0)), 'LIKE wildcards in search are matched literally');
select pg_temp.expect((select array_agg(id) = array[:'l4'::uuid] from public.admin_list_listings(null,'%',20,0)), 'a bare % matches only titles containing a literal %');
select pg_temp.expect((select array_agg(id) = array[:'l4'::uuid] from public.admin_list_listings(null,'_',20,0)), 'a bare _ matches only titles containing a literal _');
select pg_temp.expect((select count(*) = 0 from public.admin_list_listings(null,$q$'); drop table public.products; --$q$,20,0)), 'SQL-looking search text is just text');
select pg_temp.expect((select count(*) = 1 from public.admin_list_listings(null,'provider q',20,0)), 'search matches the provider name');
select pg_temp.expect((select count(*) = 1 from public.admin_list_accounts('bn-test-renter@roldex.me',20,0)), 'admin can find an account by email');
select pg_temp.expect(
  (select pg_catalog.pg_get_function_result('public.admin_list_accounts(text, integer, integer)'::regprocedure)
     !~* '(password|token|secret|phone|raw_|session)'),
  'admin_list_accounts returns no credential, token or metadata columns');
select pg_temp.expect_error($$select encrypted_password from auth.users limit 1$$, 'denied', 'admin cannot read Auth credentials directly');

-- Moderation -------------------------------------------------------------------
select pg_temp.expect_error(format($$select public.moderate_listing(%L,'approve','',%L)$$, :'l1', '2000-01-01T00:00:00Z'), 'stale_listing', 'decision on an outdated version is refused');
select pg_temp.expect_error(format($$select public.moderate_listing(%L,'publish','',%L)$$, :'l1', :'v1'), 'invalid_decision', 'unknown decision is refused');
select pg_temp.expect_error(format($$select public.moderate_listing(%L,'reject','too short',%L)$$, :'l1', :'v1'), 'reason_required', 'rejection needs a real reason');
select pg_temp.expect_error(format($$select public.moderate_listing(%L,'reject',%L,%L)$$, :'l1', repeat('x', 501), :'v1'), 'reason_too_long', 'rejection reason is bounded');
select pg_temp.expect_error(format($$select public.moderate_listing(%L,'approve','',now())$$, :'l4'), 'invalid_transition', 'a draft cannot be approved');
select pg_temp.expect_error(format($$select public.moderate_listing(%L,'approve','',%L)$$, :'l3', :'v3'), 'listing_incomplete', 'a listing without photos cannot be published');
select pg_temp.expect_error($$select public.moderate_listing('00000000-0000-4000-a000-000000000000','approve','',now())$$, 'listing_not_found', 'unknown listing id is refused');

select pg_temp.expect(public.moderate_listing(:'l1', 'approve', '', :'v1') = 'published', 'admin approves a complete pending listing');
select pg_temp.expect(
  (select moderated_by = :'a1'::uuid and moderated_at is not null and moderation_reason is null from public.products where id = :'l1'),
  'approval records the admin and time');
select pg_temp.expect((select count(*) = 1 from public.admin_audit_logs where target_id = :'l1' and action = 'listing.approve'), 'approval is audited once');
select pg_temp.expect(public.moderate_listing(:'l1', 'approve', '', :'v1') = 'published', 'repeating the approval is a harmless no-op');
select pg_temp.expect((select count(*) = 1 from public.admin_audit_logs where target_id = :'l1'), 'repeated approval adds no second audit row');

select pg_temp.expect(public.moderate_listing(:'l2', 'reject', '<script>alert(1)</script> Photos are blurry, please retake.', :'v2') = 'rejected', 'admin rejects with a reason');
select pg_temp.expect(public.moderate_listing(:'l2', 'reject', 'Repeat of the same decision', :'v2') = 'rejected', 'repeating the rejection is a no-op');
select pg_temp.expect((select count(*) = 1 from public.admin_audit_logs where target_id = :'l2'), 'repeated rejection adds no second audit row');

-- Admin correction --------------------------------------------------------------
-- (now() is the transaction start, so inside this single test transaction
-- updated_at does not advance; a clearly older version stands in for a
-- stale page. In the app each action is its own transaction.)
select updated_at as v1b from public.products where id = :'l1' \gset
select pg_temp.expect_error(format($$select public.admin_edit_listing(%L,%L,'New title','A wooden study table in good condition.','study_essentials','good','City Centre','Near Jiwaji University','Fixing a typo here')$$, :'l1', '2000-01-01T00:00:00Z'), 'stale_listing', 'correction on an outdated version is refused');
select pg_temp.expect_error(format($$select public.admin_edit_listing(%L,%L,'New title','x','study_essentials','good','City Centre','','short')$$, :'l1', :'v1b'), 'reason_required', 'correction needs a reason');
select pg_temp.expect_error(format($$select public.admin_edit_listing(%L,%L,'New title','x','household','good','City Centre','','Fixing the category')$$, :'l1', :'v1b'), 'invalid_category', 'correction validates enums');
select pg_temp.expect(
  public.admin_edit_listing(:'l1', :'v1b', 'Study table <img src=x onerror=alert(1)>', 'A wooden study table in good condition.',
                            'study_essentials', 'good', 'City Centre', 'Near Jiwaji University', 'Fixing the title wording') = 'published',
  'correction keeps the published status');
select pg_temp.expect(
  (select title = 'Study table <img src=x onerror=alert(1)>' and price_per_day = 55 and deposit = 1200 from public.products where id = :'l1'),
  'correction stores text verbatim and leaves price and deposit unchanged');
select pg_temp.expect(
  (select summary -> 'before' ->> 'title' = 'Stage4 study table' and summary -> 'after' ? 'title'
          and not (summary -> 'after' ? 'price_per_day')
   from public.admin_audit_logs where target_id = :'l1' and action = 'listing.edit'),
  'correction audit records only changed public fields');
select updated_at as v1c from public.products where id = :'l1' \gset
select public.admin_edit_listing(:'l1', :'v1c', 'Study table <img src=x onerror=alert(1)>', 'A wooden study table in good condition.',
                                 'study_essentials', 'good', 'City Centre', 'Near Jiwaji University', 'Saving with no change');
select pg_temp.expect((select count(*) = 1 from public.admin_audit_logs where target_id = :'l1' and action = 'listing.edit'), 'a no-change correction is not audited');

select pg_temp.expect_error(format($$insert into public.admin_audit_logs (actor_id, action, target_type, target_id) values (%L,'listing.approve','product',%L)$$, :'a1', :'l1'), 'denied', 'admins cannot insert audit rows directly');
select pg_temp.expect_error($$update public.admin_audit_logs set reason = 'rewritten'$$, 'denied', 'admins cannot rewrite audit rows');
select pg_temp.expect_error($$delete from public.admin_audit_logs$$, 'denied', 'admins cannot delete audit rows');
reset role;

-- Public and provider views after decisions --------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect(exists (select 1 from public.published_products() where id = :'l1'), 'approved listing is publicly visible');
select pg_temp.expect(not exists (select 1 from public.published_products() where id = :'l2'), 'rejected listing stays private');
select pg_temp.expect(not exists (select 1 from public.published_products() where id = :'l3'), 'pending listing stays private');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'claims_p', true);
select pg_temp.expect(
  (select moderation_reason = '<script>alert(1)</script> Photos are blurry, please retake.' from public.products where id = :'l2'),
  'provider can read the rejection reason, stored as plain text');
reset role;

-- Accounts ------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', :'claims_a1', true);
select pg_temp.expect_error(format($$select public.suspend_account(%L,'Testing self suspension')$$, :'a1'), 'cannot_suspend_self', 'an admin cannot suspend themselves');
select pg_temp.expect_error(format($$select public.suspend_account(%L,'short')$$, :'p'), 'reason_required', 'suspension needs a reason');
select pg_temp.expect_error($$select public.suspend_account('00000000-0000-4000-a000-000000000000','Unknown account test')$$, 'account_not_found', 'unknown account is refused');
select pg_temp.expect(public.suspend_account(:'p', 'Repeated policy violations reported') = 'suspended', 'admin suspends a provider');
select pg_temp.expect(public.suspend_account(:'p', 'Repeated policy violations reported') = 'suspended', 'repeating the suspension is a no-op');
select pg_temp.expect((select count(*) = 1 from public.admin_audit_logs where target_id = :'p' and action = 'account.suspend'), 'suspension is audited exactly once');
select pg_temp.expect((select count(*) = 3 from public.products where provider_id = :'p'), 'suspension keeps all three of the provider''s listings');
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect(not exists (select 1 from public.published_products() where id = :'l1'), 'suspended provider''s listing leaves the catalogue immediately');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'claims_p', true);
select pg_temp.expect_error($$select public.create_listing_draft('Table','','furniture','good',1,0,'Thatipur','','Valid address','')$$, 'not_active_provider', 'suspended provider is blocked on their next request');
select pg_temp.expect((select count(*) = 0 from public.products), 'suspended provider can no longer read their listings');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', :'claims_a1', true);
select pg_temp.expect(public.restore_account(:'p', 'Issue resolved with the provider') = 'active', 'admin restores the provider');
select pg_temp.expect((select listing_status = 'published' from public.products where id = :'l1'), 'restoring keeps the listing''s documented status');
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect(exists (select 1 from public.published_products() where id = :'l1'), 'a restored provider''s published listing is public again');
reset role;

-- Admin suspension and the last-admin guard
set local role authenticated;
select set_config('request.jwt.claims', :'claims_a1', true);
select pg_temp.expect(public.suspend_account(:'a2', 'Admin access no longer needed') = 'suspended', 'an admin can suspend another admin while one stays active');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'claims_a2', true);
select pg_temp.expect_error(format($$select public.restore_account(%L,'Trying to restore myself')$$, :'a2'), 'not_active_admin', 'a suspended admin loses admin powers immediately');
select pg_temp.expect_error($$select * from public.admin_list_audit(null,20,0)$$, 'not_active_admin', 'a suspended admin cannot read the audit log');
reset role;

do $$ begin raise notice 'All Stage 4 boundary tests passed.'; end $$;
rollback;
