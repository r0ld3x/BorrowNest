-- BorrowNest Stage 5: public catalogue boundary tests.
-- Runs as anon / authenticated with JWT claims, then rolls back.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stage5_catalogue.sql

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
grant execute on function pg_temp.expect(boolean, text) to anon, authenticated;

\set pa '50000000-0000-4000-a000-0000000000a1'
\set pb '50000000-0000-4000-a000-0000000000b1'
\set pub1  '51000000-0000-4000-a000-000000000001'
\set pub2  '51000000-0000-4000-a000-000000000002'
\set draft '51000000-0000-4000-a000-000000000003'
\set pend  '51000000-0000-4000-a000-000000000004'
\set bpub  '51000000-0000-4000-a000-000000000005'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'pa', 'bn-test-cat-provider-a@roldex.me', '{"full_name":"Asha Verma","account_type":"provider"}'),
  (:'pb', 'bn-test-cat-provider-b@roldex.me', '{"full_name":"Bhavesh Rao","account_type":"provider"}');

insert into public.products (id, provider_id, title, description, category, condition, price_per_day, deposit, area, landmark, listing_status, moderated_at, moderation_reason) values
  (:'pub1', :'pa', 'Zz5 teak study desk', 'A sturdy desk for exam prep in Zz5 town.', 'study_essentials', 'good', 30, 500, 'Zz5 Morar', 'Near test gate', 'published', now() - interval '2 days', 'internal approval note'),
  (:'pub2', :'pa', 'Zz5 100% cotton mattress', 'Clean mattress, Zz5 sized single.', 'furniture', 'like_new', 75, 900, 'zz5 morar', '', 'published', now() - interval '1 day', null),
  (:'draft', :'pa', 'Zz5 secret draft', 'Not ready for anyone to see yet.', 'other', 'good', 10, 0, 'Zz5 Morar', '', 'draft', null, null),
  (:'pend', :'pa', 'Zz5 pending item', 'Waiting for an admin to look at it.', 'kitchen', 'good', 20, 0, 'Zz5 Morar', '', 'pending_review', null, null),
  (:'bpub', :'pb', 'Zz5 bicycle from B', 'Provider B''s published bicycle.', 'bicycles', 'fair', 50, 1000, 'Zz5 Lashkar', '', 'published', now(), null);
insert into public.product_pickup_details (product_id, exact_address) values
  (:'pub1', 'ZZ5-SECRET-ADDRESS-ONE'), (:'pub2', 'ZZ5-SECRET-ADDRESS-TWO'),
  (:'draft', 'ZZ5-SECRET-ADDRESS-DRAFT'), (:'bpub', 'ZZ5-SECRET-ADDRESS-B');
insert into public.product_images (product_id, storage_path, sort_order, caption) values
  (:'pub1', 'zz5/pub1-b.webp', 1, 'Second'), (:'pub1', 'zz5/pub1-a.webp', 0, 'Cover'),
  (:'draft', 'zz5/draft.webp', 0, 'Draft photo'), (:'bpub', 'zz5/b.webp', 0, null);

-- Function signatures expose no private columns -------------------------------
select pg_temp.expect(
  (select bool_and(pg_catalog.pg_get_function_result(p.oid) !~* '(address|instruction|moderation|provider_id|email|account_status|full_name|role)')
   from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('search_published_products', 'get_published_product', 'get_published_product_images', 'published_areas')),
  'catalogue functions return no address, moderation, provider id, email, name or status columns');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

-- Visibility
select pg_temp.expect(
  (select array_agg(id order by id) from public.search_published_products('zz5', null, '', null, null, 'newest', 48, 0))
  = array[:'pub1'::uuid, :'pub2'::uuid, :'bpub'::uuid],
  'search returns exactly the three published listings');
select pg_temp.expect((select count(*) = 0 from public.get_published_product(:'draft')), 'a draft is not reachable by id');
select pg_temp.expect((select count(*) = 0 from public.get_published_product(:'pend')), 'a pending listing is not reachable by id');
select pg_temp.expect((select count(*) = 0 from public.get_published_product_images(:'draft')), 'draft photo metadata is not reachable');
select pg_temp.expect((select count(*) = 0 from public.get_published_product('00000000-0000-4000-a000-000000000000')), 'unknown id returns nothing');
select pg_temp.expect((select count(*) = 1 from public.get_published_product(:'pub1')), 'a published listing is reachable by id');
select pg_temp.expect((select listed_by = 'Asha' from public.get_published_product(:'pub1')), 'only the provider''s first name is exposed');
select pg_temp.expect(
  (select array_agg(caption order by sort_order) = array['Cover', 'Second'] from public.get_published_product_images(:'pub1')),
  'photos come back in display order, cover first');
select pg_temp.expect(
  (select cover_path = 'zz5/pub1-a.webp' and image_count = 2 from public.search_published_products('teak', null, '', null, null, 'newest', 48, 0)),
  'search results carry the cover photo and photo count');

-- Filters, sorts, and hostile input
select pg_temp.expect((select count(*) = 1 from public.search_published_products('zz5', 'bicycles', '', null, null, 'newest', 48, 0)), 'category filter');
select pg_temp.expect((select count(*) = 2 from public.search_published_products('zz5', null, 'ZZ5 MORAR', null, null, 'newest', 48, 0)), 'area filter is case-insensitive');
select pg_temp.expect((select count(*) = 2 from public.search_published_products('zz5', null, '', 40, 80, 'newest', 48, 0)), 'price range filter');
select pg_temp.expect(
  (select array_agg(price_per_day order by ordinality) = array[30, 50, 75]::numeric[]
   from public.search_published_products('zz5', null, '', null, null, 'price_asc', 48, 0) with ordinality),
  'price low-to-high sort');
select pg_temp.expect(
  (select array_agg(price_per_day order by ordinality) = array[75, 50, 30]::numeric[]
   from public.search_published_products('zz5', null, '', null, null, 'price_desc', 48, 0) with ordinality),
  'price high-to-low sort');
select pg_temp.expect(
  (select array_agg(id order by ordinality) = array[:'bpub'::uuid, :'pub2'::uuid, :'pub1'::uuid]
   from public.search_published_products('zz5', null, '', null, null, 'title; drop table products', 48, 0) with ordinality),
  'an unsupported sort falls back to newest first');
select pg_temp.expect((select count(*) = 1 from public.search_published_products('100%', null, '', null, null, 'newest', 48, 0)), 'a % in search is literal');
select pg_temp.expect((select count(*) = 0 from public.search_published_products('_', null, 'Zz5 Morar', null, null, 'newest', 48, 0)), 'an _ in search is literal');
select pg_temp.expect((select count(*) = 0 from public.search_published_products($q$') or 1=1 --$q$, null, '', null, null, 'newest', 48, 0)), 'SQL-looking search text is just text');
select pg_temp.expect((select count(*) = 0 from public.search_published_products('ZZ5-SECRET-ADDRESS', null, '', null, null, 'newest', 48, 0)), 'search never matches pickup addresses');
select pg_temp.expect((select count(*) = 0 from public.search_published_products('internal approval note', null, '', null, null, 'newest', 48, 0)), 'search never matches moderation notes');
select pg_temp.expect((select count(*) = 0 from public.search_published_products('secret draft', null, '', null, null, 'newest', 48, 0)), 'search never finds drafts');
select pg_temp.expect((select count(*) = 1 from public.search_published_products('zz5', null, '', null, null, 'newest', 0, 0)), 'page size is clamped up to 1');
select pg_temp.expect((select count(*) <= 48 from public.search_published_products('', null, '', null, null, 'newest', 1000000, 0)), 'page size is clamped to 48');
select pg_temp.expect((select count(*) = 0 from public.search_published_products('zz5', null, '', null, null, 'newest', 48, 2000000000)), 'a huge offset is bounded and returns nothing');
select pg_temp.expect((select bool_and(total_count = 3) from public.search_published_products('zz5', null, '', null, null, 'newest', 1, 0)), 'total count reflects all matches, not just the page');
select pg_temp.expect(
  exists (select 1 from public.published_areas() where lower(area) = 'zz5 morar' and listing_count = 2)
  and not exists (select 1 from public.published_areas() where area ilike '%secret%'),
  'areas list counts only published listings, grouped case-insensitively');
reset role;

-- Provider A's drafts stay private from provider B -------------------------
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'pb'), true);
select pg_temp.expect((select count(*) = 0 from public.get_published_product(:'draft')), 'provider B cannot open A''s draft through the catalogue');
select pg_temp.expect((select count(*) = 0 from public.products where id = :'draft'), 'provider B cannot read A''s draft from the table');
select pg_temp.expect((select count(*) = 0 from public.product_images where product_id = :'draft'), 'provider B cannot read A''s draft photo metadata');
reset role;

-- Suspension and unpublishing take effect on the next query ----------------
update public.profiles set account_status = 'suspended' where id = :'pa';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect(
  (select array_agg(id) = array[:'bpub'::uuid] from public.search_published_products('zz5', null, '', null, null, 'newest', 48, 0)),
  'a suspended provider''s listings leave search immediately');
select pg_temp.expect((select count(*) = 0 from public.get_published_product(:'pub1')), 'a suspended provider''s listing detail is hidden');
select pg_temp.expect((select count(*) = 0 from public.get_published_product_images(:'pub1')), 'a suspended provider''s photos are hidden');
select pg_temp.expect(not exists (select 1 from public.published_areas() where lower(area) = 'zz5 morar'), 'areas drop a suspended provider''s listings');
reset role;

update public.products set listing_status = 'paused' where id = :'bpub';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect((select count(*) = 0 from public.search_published_products('zz5', null, '', null, null, 'newest', 48, 0)), 'a paused listing leaves search immediately');
reset role;

do $$ begin raise notice 'All Stage 5 boundary tests passed.'; end $$;
rollback;
