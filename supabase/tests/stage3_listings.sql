-- BorrowNest Stage 3: provider listing and photo boundary tests.
--
-- Runs as user-scoped roles (anon / authenticated with JWT claims) like the
-- Data API and Storage API do, inside one transaction that is rolled back.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stage3_listings.sql
-- Signature tests that need the Vault key run only once it is configured
-- (supabase/operator/set-image-attestation-key.sh); otherwise the test
-- checks that attaching fails closed.

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

-- Expects the statement to fail with 'BN:<code>' or, for code 'denied',
-- with insufficient_privilege / an RLS violation.
create function pg_temp.expect_error(statement text, expected text, description text)
returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'BOUNDARY TEST FAILED: % (statement succeeded)', description;
exception
  when others then
    if sqlerrm like 'BOUNDARY TEST FAILED%' then
      raise;
    end if;
    if (expected = 'denied' and sqlstate = '42501') or sqlerrm = 'BN:' || expected then
      raise notice 'ok - %', description;
    else
      raise exception 'BOUNDARY TEST FAILED: % (got % %)', description, sqlstate, sqlerrm;
    end if;
end;
$$;

grant execute on function pg_temp.expect(boolean, text) to anon, authenticated;
grant execute on function pg_temp.expect_error(text, text, text) to anon, authenticated;

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('30000000-0000-4000-a000-0000000000a1', 'bn-test-provider-a@roldex.me', '{"full_name":"Provider A","account_type":"provider"}'),
  ('30000000-0000-4000-a000-0000000000b1', 'bn-test-provider-b@roldex.me', '{"full_name":"Provider B","account_type":"provider"}'),
  ('30000000-0000-4000-a000-0000000000c1', 'bn-test-renter@roldex.me',     '{"full_name":"Renter","account_type":"renter"}'),
  ('30000000-0000-4000-a000-0000000000d1', 'bn-test-suspended@roldex.me',  '{"full_name":"Suspended","account_type":"provider"}');
update public.profiles set account_status = 'suspended' where id = '30000000-0000-4000-a000-0000000000d1';

-- Provider B owns one draft with a private address.
insert into public.products (id, provider_id, title, description, category, condition, price_per_day, deposit, area)
values ('31000000-0000-4000-a000-0000000000b1', '30000000-0000-4000-a000-0000000000b1', 'B private draft',
        'A private draft owned by provider B', 'kitchen', 'good', 40, 0, 'Morar');
insert into public.product_pickup_details (product_id, exact_address)
values ('31000000-0000-4000-a000-0000000000b1', 'B private test address');

select exists (select 1 from vault.secrets where name = 'borrownest_image_attestation') as has_key \gset

-- Provider A: create and validate -------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-0000000000a1","role":"authenticated"}', true);

select public.create_listing_draft(
  '  Study   table <b>with</b> chair ', 'Solid wood study table with a matching chair.', 'study_essentials', 'good',
  55, 1200.50, ' City  Centre ', 'Near Jiwaji University', 'A test address, not real', ''
) as pid \gset

select pg_temp.expect(
  (select listing_status = 'draft' and city = 'Gwalior' and provider_id = '30000000-0000-4000-a000-0000000000a1'
          and title = 'Study table <b>with</b> chair' and area = 'City Centre'
   from public.products where id = :'pid'),
  'draft created as draft, in Gwalior, owned by the caller, text normalized and HTML kept as text');
select pg_temp.expect((select count(*) = 1 from public.product_pickup_details where product_id = :'pid'),
  'owner can read their own pickup details');

select pg_temp.expect_error($$select public.create_listing_draft('ab','','furniture','good',1,0,'Thatipur','','Valid address','')$$, 'invalid_title', 'title too short is rejected');
select pg_temp.expect_error($$select public.create_listing_draft('Table','','household','good',1,0,'Thatipur','','Valid address','')$$, 'invalid_category', 'unknown category is rejected');
select pg_temp.expect_error($$select public.create_listing_draft('Table','','furniture','excellent',1,0,'Thatipur','','Valid address','')$$, 'invalid_condition', 'unknown condition is rejected');
select pg_temp.expect_error($$select public.create_listing_draft('Table','','furniture','good',55.555,0,'Thatipur','','Valid address','')$$, 'invalid_price', 'price with 3 decimals is rejected, not rounded');
select pg_temp.expect_error($$select public.create_listing_draft('Table','','furniture','good',0,0,'Thatipur','','Valid address','')$$, 'invalid_price', 'zero price is rejected');
select pg_temp.expect_error($$select public.create_listing_draft('Table','','furniture','good',1,-1,'Thatipur','','Valid address','')$$, 'invalid_deposit', 'negative deposit is rejected');
select pg_temp.expect_error($$select public.create_listing_draft('Table','','furniture','good',1,0,'Thatipur','','1234','')$$, 'invalid_address', 'short address is rejected');
select pg_temp.expect_error($$select public.create_listing_draft('Table','','furniture','good',1,0,'Thatipur',repeat('x',121),'Valid address','')$$, 'invalid_landmark', 'overlong landmark is rejected');

-- Direct table writes stay closed
select pg_temp.expect_error(format($$update public.products set provider_id = '30000000-0000-4000-a000-0000000000b1' where id = %L$$, :'pid'), 'denied', 'provider cannot change provider_id directly');
select pg_temp.expect_error(format($$update public.products set listing_status = 'published' where id = %L$$, :'pid'), 'denied', 'provider cannot publish or approve directly');
select pg_temp.expect_error(format($$update public.products set moderation_reason = 'ok' where id = %L$$, :'pid'), 'denied', 'provider cannot write moderation fields');
select pg_temp.expect_error($$insert into public.products (provider_id, title, category, condition, price_per_day, area) values ('30000000-0000-4000-a000-0000000000a1','X x x','other','new',1,'Lashkar')$$, 'denied', 'provider cannot insert products directly');
select pg_temp.expect_error(format($$insert into public.product_images (product_id, storage_path, sort_order) values (%L, 'x', 0)$$, :'pid'), 'denied', 'provider cannot insert image metadata directly');

select pg_temp.expect_error(format($$select public.submit_listing(%L)$$, :'pid'), 'missing_images', 'submit without a photo is rejected');

-- Storage upload policies (as the Storage API inserts them) ----------------
select :'pid' as pid_text \gset
select '30000000-0000-4000-a000-0000000000a1/' || :'pid' || '/' || gen_random_uuid() || '.webp' as path1 \gset
select '30000000-0000-4000-a000-0000000000a1/' || :'pid' || '/' || gen_random_uuid() || '.webp' as path2 \gset

insert into storage.objects (bucket_id, name, owner_id) values ('product-photos', :'path1', '30000000-0000-4000-a000-0000000000a1');
select pg_temp.expect(true, 'provider can upload into their own listing folder');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name, owner_id) values ('product-photos', '30000000-0000-4000-a000-0000000000b1/31000000-0000-4000-a000-0000000000b1/' || gen_random_uuid() || '.webp', '30000000-0000-4000-a000-0000000000a1')$$, 'denied', 'provider cannot upload into another provider''s folder');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name, owner_id) values ('product-photos', '30000000-0000-4000-a000-0000000000a1/31000000-0000-4000-a000-0000000000b1/' || gen_random_uuid() || '.webp', '30000000-0000-4000-a000-0000000000a1')$$, 'denied', 'provider cannot upload under another provider''s product id');
select pg_temp.expect_error(format($$insert into storage.objects (bucket_id, name, owner_id) values ('product-photos', %L, '30000000-0000-4000-a000-0000000000a1')$$, '30000000-0000-4000-a000-0000000000a1/' || :'pid' || '/photo.svg'), 'denied', 'non-WebP or non-random object names are rejected');
select pg_temp.expect_error(format($$insert into storage.objects (bucket_id, name, owner_id) values ('product-photos', %L, '30000000-0000-4000-a000-0000000000a1')$$, '30000000-0000-4000-a000-0000000000a1/../' || :'pid' || '/x.webp'), 'denied', 'path traversal names are rejected');
select pg_temp.expect((select count(*) = 0 from storage.objects where bucket_id = 'product-photos' and name like '30000000-0000-4000-a000-0000000000b1/%'),
  'provider cannot list another provider''s objects');

-- Attaching photos -----------------------------------------------------------
select pg_temp.expect_error(format($$select public.attach_product_image(%L, %L, '', 'forged')$$, :'pid', :'path1'),
  case when :'has_key' then 'invalid_image_signature' else 'attestation_not_configured' end,
  'attach with a forged signature fails closed');
select pg_temp.expect_error(format($$select public.attach_product_image(%L, %L, '', 'x')$$, :'pid', '30000000-0000-4000-a000-0000000000b1/31000000-0000-4000-a000-0000000000b1/00000000-0000-4000-a000-000000000001.webp'),
  'invalid_image_path', 'provider cannot attach another provider''s object');
select pg_temp.expect_error($$select public.attach_product_image('31000000-0000-4000-a000-0000000000b1', 'a', '', 'x')$$,
  'listing_not_found', 'provider cannot attach to another provider''s product');
reset role;

\if :has_key
  select encode(extensions.hmac('v1:30000000-0000-4000-a000-0000000000a1:' || :'pid' || ':' || :'path1', private.image_attestation_key(), 'sha256'), 'hex') as sig1 \gset
  select encode(extensions.hmac('v1:30000000-0000-4000-a000-0000000000a1:' || :'pid' || ':' || :'path2', private.image_attestation_key(), 'sha256'), 'hex') as sig2 \gset

  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-0000000000a1","role":"authenticated"}', true);

  select pg_temp.expect_error(format($$select public.attach_product_image(%L, %L, '', %L)$$, :'pid', :'path2', :'sig2'),
    'image_not_uploaded', 'a signed path with no uploaded object is rejected');
  select pg_temp.expect_error(format($$select public.attach_product_image(%L, %L, %L, %L)$$, :'pid', :'path1', repeat('c', 201), :'sig1'),
    'invalid_caption', 'overlong caption is rejected');
  select public.attach_product_image(:'pid', :'path1', '  Front <i>view</i> ', :'sig1') as img1 \gset
  select pg_temp.expect((select sort_order = 0 and caption = 'Front <i>view</i>' from public.product_images where id = :'img1'),
    'validly signed upload attaches as the cover with a cleaned caption');
  select pg_temp.expect_error(format($$select public.attach_product_image(%L, %L, '', %L)$$, :'pid', :'path1', :'sig1'),
    'image_already_used', 'the same object cannot be attached twice');
  select pg_temp.expect_error(format($$insert into storage.objects (bucket_id, name, owner_id) values ('product-photos', %L, '30000000-0000-4000-a000-0000000000a1')$$, :'path1'),
    'denied', 'an attached path cannot be re-uploaded');

  -- Fill to the 5-photo limit, then try a sixth.
  reset role;
  create temp table extra (n int, path text, sig text);
  grant select on extra to authenticated;
  insert into extra
  select n, p, encode(extensions.hmac('v1:30000000-0000-4000-a000-0000000000a1:' || :'pid' || ':' || p, private.image_attestation_key(), 'sha256'), 'hex')
  from (select n, '30000000-0000-4000-a000-0000000000a1/' || :'pid' || '/' || gen_random_uuid() || '.webp' as p from generate_series(1, 5) n) s;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-0000000000a1","role":"authenticated"}', true);
  insert into storage.objects (bucket_id, name, owner_id) select 'product-photos', path, '30000000-0000-4000-a000-0000000000a1' from extra;
  select public.attach_product_image(:'pid', path, '', sig) from extra where n <= 4;
  select pg_temp.expect((select count(*) = 5 from public.product_images where product_id = :'pid'), 'five photos can be attached');
  select pg_temp.expect_error(format($$select public.attach_product_image(%L, %L, '', %L)$$, :'pid', (select path from extra where n = 5), (select sig from extra where n = 5)),
    'image_limit', 'a sixth photo is rejected');

  -- Reordering
  select pg_temp.expect_error(format($$select public.reorder_product_images(%L, %L::uuid[])$$, :'pid', '{' || :'img1' || '}'),
    'invalid_image_order', 'reorder must include every photo exactly once');
  select pg_temp.expect_error(format($$select public.reorder_product_images(%L, %L::uuid[])$$, :'pid',
      -- Five entries, right length, but img1 twice and one photo missing.
      (select '{' || :'img1' || ',' || :'img1' || ',' || string_agg(id::text, ',') || '}' from (select id from public.product_images where product_id = :'pid' and id <> :'img1' order by sort_order limit 3) t)),
    'invalid_image_order', 'reorder rejects a list that repeats one photo and drops another');
  select public.reorder_product_images(:'pid', (select array_agg(id order by sort_order desc) from public.product_images where product_id = :'pid'));
  select pg_temp.expect(
    (select array_agg(sort_order order by sort_order) = '{0,1,2,3,4}' from public.product_images where product_id = :'pid')
    and (select sort_order = 4 from public.product_images where id = :'img1'),
    'reorder persists a unique deterministic order and moves the cover');

  -- Removing re-compacts the order
  select public.remove_product_image(:'img1') = :'path1' as removed \gset
  select pg_temp.expect(:'removed'::boolean, 'remove returns the detached object path');
  select pg_temp.expect((select array_agg(sort_order order by sort_order) = '{0,1,2,3}' from public.product_images where product_id = :'pid'),
    'remaining photos are renumbered without gaps');
  select pg_temp.expect_error(format($$select public.attach_product_image(%L, %L, '', %L)$$, :'pid', :'path1', :'sig1'),
    'image_already_used', 'a removed path cannot be re-attached (no replay of old signatures)');
  reset role;
\else
  select pg_temp.expect(true, 'SKIPPED signature, limit, reorder and remove tests: attestation key not configured');
  -- Attach the image as the owner would after a server upload, so the
  -- lifecycle tests below can still run.
  insert into public.product_images (product_id, storage_path, sort_order) values (:'pid', :'path1', 0);
\endif

-- Lifecycle --------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-0000000000a1","role":"authenticated"}', true);

select pg_temp.expect(public.submit_listing(:'pid') = 'pending_review', 'complete draft can be submitted for review');
select pg_temp.expect(public.submit_listing(:'pid') = 'pending_review', 'repeated submit is idempotent');
select pg_temp.expect_error(format($$select public.pause_listing(%L)$$, :'pid'), 'invalid_transition', 'pending listing cannot be paused');
select pg_temp.expect_error(format($$select public.resume_listing(%L)$$, :'pid'), 'invalid_transition', 'provider cannot publish a pending listing via resume');
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect(not exists (select 1 from public.published_products() where id = :'pid'), 'pending listing is not public');
select pg_temp.expect(not exists (select 1 from public.published_product_images() where product_id = :'pid'), 'pending listing photos are not in the public catalogue');
select pg_temp.expect_error($$select public.create_listing_draft('Table','','furniture','good',1,0,'Thatipur','','Valid address','')$$, 'denied', 'anon cannot call provider functions');
reset role;

-- Simulate the Stage 4 admin approval (operator privileges).
update public.products set listing_status = 'published', moderated_at = now(), moderation_reason = 'approved note' where id = :'pid';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-0000000000a1","role":"authenticated"}', true);
select pg_temp.expect(public.pause_listing(:'pid') = 'paused', 'published listing can be paused');
select pg_temp.expect(public.resume_listing(:'pid') = 'published', 'paused listing can be resumed');
select pg_temp.expect(
  public.update_listing(:'pid', 'Study table <b>with</b> chair', 'Solid wood study table with a matching chair.', 'study_essentials', 'good',
                        55, 1200.50, 'City Centre', 'Near Jiwaji University', 'A test address, not real', '') = 'published',
  'saving unchanged content keeps a published listing published');
select pg_temp.expect(
  public.update_listing(:'pid', 'Study table <b>with</b> chair', 'Solid wood study table with a matching chair.', 'study_essentials', 'good',
                        60, 1200.50, 'City Centre', 'Near Jiwaji University', 'A test address, not real', '') = 'pending_review',
  'content edit to a published listing returns it to review');
select pg_temp.expect(
  (select moderated_at is null and moderation_reason is null from public.products where id = :'pid'),
  'obsolete approval fields are cleared');
select pg_temp.expect(public.archive_listing(:'pid') = 'archived', 'listing can be archived');
select pg_temp.expect(exists (select 1 from public.products where id = :'pid'), 'archiving keeps the row');
select pg_temp.expect_error(format($$select public.update_listing(%L,'Study table','','furniture','good',1,0,'Thatipur','','Valid address','')$$, :'pid'),
  'listing_archived', 'archived listing cannot be edited');
select pg_temp.expect_error(format($$insert into storage.objects (bucket_id, name, owner_id) values ('product-photos', %L, '30000000-0000-4000-a000-0000000000a1')$$, '30000000-0000-4000-a000-0000000000a1/' || :'pid' || '/' || gen_random_uuid() || '.webp'),
  'denied', 'no uploads into an archived listing');
reset role;

-- A real image id of A's, known only to the operator, to probe with as B.
select id as a_img from public.product_images where product_id = :'pid' order by sort_order limit 1 \gset

-- Provider B: cannot touch A's listing ----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-0000000000b1","role":"authenticated"}', true);
select pg_temp.expect(not exists (select 1 from public.products where id = :'pid'), 'provider B cannot read A''s listing');
select pg_temp.expect(not exists (select 1 from public.product_pickup_details where product_id = :'pid'), 'provider B cannot read A''s pickup address');
select pg_temp.expect(not exists (select 1 from public.product_images where product_id = :'pid'), 'provider B cannot read A''s photo metadata');
select pg_temp.expect_error(format($$select public.update_listing(%L,'Hijack','','furniture','good',1,0,'Thatipur','','Valid address','')$$, :'pid'), 'listing_not_found', 'provider B cannot edit A''s listing');
select pg_temp.expect_error(format($$select public.submit_listing(%L)$$, :'pid'), 'listing_not_found', 'provider B cannot submit A''s listing');
select pg_temp.expect_error(format($$select public.archive_listing(%L)$$, :'pid'), 'listing_not_found', 'provider B cannot archive A''s listing');
select pg_temp.expect_error(format($$select public.remove_product_image(%L)$$, :'a_img'), 'image_not_found', 'provider B cannot remove A''s photo, even knowing its id');
select pg_temp.expect_error(format($$select public.reorder_product_images(%L, %L::uuid[])$$, :'pid', '{' || :'a_img' || '}'), 'listing_not_found', 'provider B cannot reorder A''s photos');
select pg_temp.expect_error($$select public.update_listing('00000000-0000-4000-a000-000000000000','Ghost','','furniture','good',1,0,'Thatipur','','Valid address','')$$, 'listing_not_found', 'missing and foreign listings fail identically');
reset role;

-- Provider A cannot read B's draft or address
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-0000000000a1","role":"authenticated"}', true);
select pg_temp.expect(not exists (select 1 from public.products where id = '31000000-0000-4000-a000-0000000000b1'), 'provider A cannot read B''s draft');
select pg_temp.expect(not exists (select 1 from public.product_pickup_details where product_id = '31000000-0000-4000-a000-0000000000b1'), 'provider A cannot read B''s pickup address');
reset role;

-- Renter and suspended provider cannot write -----------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-0000000000c1","role":"authenticated"}', true);
select pg_temp.expect_error($$select public.create_listing_draft('Table','','furniture','good',1,0,'Thatipur','','Valid address','')$$, 'not_active_provider', 'renter cannot create listings');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name, owner_id) values ('product-photos', '30000000-0000-4000-a000-0000000000c1/31000000-0000-4000-a000-0000000000b1/' || gen_random_uuid() || '.webp', '30000000-0000-4000-a000-0000000000c1')$$, 'denied', 'renter cannot upload product photos');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-0000000000d1","role":"authenticated"}', true);
select pg_temp.expect_error($$select public.create_listing_draft('Table','','furniture','good',1,0,'Thatipur','','Valid address','')$$, 'not_active_provider', 'suspended provider cannot create listings');
reset role;

-- Suspending A immediately blocks edits to existing listings too.
update public.profiles set account_status = 'suspended' where id = '30000000-0000-4000-a000-0000000000a1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-a000-0000000000a1","role":"authenticated"}', true);
select pg_temp.expect_error(format($$select public.submit_listing(%L)$$, :'pid'), 'not_active_provider', 'a newly suspended provider is blocked on the next call');
reset role;

do $$ begin raise notice 'All Stage 3 boundary tests passed.'; end $$;
rollback;
