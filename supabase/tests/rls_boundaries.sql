-- BorrowNest Stage 2: database boundary tests.
--
-- Runs as user-scoped roles (anon / authenticated with JWT claims), the same
-- way PostgREST executes API requests. Everything happens in one transaction
-- that is rolled back, so no fixtures remain.
--
-- Run with psql against a database that has the migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_boundaries.sql
-- Any failed expectation aborts with "BOUNDARY TEST FAILED: ...".

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

-- Runs a statement and expects it to be rejected with insufficient_privilege.
create function pg_temp.expect_denied(statement text, description text)
returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'BOUNDARY TEST FAILED: % (statement was allowed)', description;
exception
  when insufficient_privilege then
    raise notice 'ok - %', description;
end;
$$;

grant execute on function pg_temp.expect(boolean, text) to anon, authenticated;
grant execute on function pg_temp.expect_denied(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as the migration owner, like Supabase Auth would)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-a000-00000000000a', 'renter-a@example.test',   '{"full_name":"Renter A","account_type":"renter"}'),
  ('00000000-0000-4000-a000-00000000000b', 'renter-b@example.test',   '{"full_name":"Renter B"}'),
  ('00000000-0000-4000-a000-0000000000c1', 'provider-a@example.test', '{"full_name":"Provider A","account_type":"provider"}'),
  ('00000000-0000-4000-a000-0000000000c2', 'provider-b@example.test', '{"full_name":"Provider B","account_type":"provider"}'),
  ('00000000-0000-4000-a000-0000000000ad', 'admin@example.test',      '{"full_name":"Admin","account_type":"renter"}'),
  ('00000000-0000-4000-a000-0000000000e1', 'sneaky@example.test',     '{"full_name":"<img src=x onerror=alert(1)>","account_type":"admin","role":"admin"}'),
  ('00000000-0000-4000-a000-0000000000e2', 'blank@example.test',      '{"full_name":"   ","account_type":"superuser"}'),
  ('00000000-0000-4000-a000-0000000000e3', 'nometa@example.test',     '{}');

-- Operator-style promotion, as in supabase/operator/promote-admin.sql.
update public.profiles set role = 'admin' where id = '00000000-0000-4000-a000-0000000000ad';

insert into public.products (id, provider_id, title, category, condition, price_per_day, deposit, area, landmark, listing_status, moderation_reason) values
  ('10000000-0000-4000-a000-0000000000a1', '00000000-0000-4000-a000-0000000000c1', 'Provider A draft', 'furniture', 'good', 100, 500, 'Thatipur', 'Near test landmark', 'draft', null),
  ('10000000-0000-4000-a000-0000000000a2', '00000000-0000-4000-a000-0000000000c1', 'Provider A published', 'bicycles', 'good', 50, 300, 'Lashkar', '', 'published', 'internal moderation note'),
  ('10000000-0000-4000-a000-0000000000b1', '00000000-0000-4000-a000-0000000000c2', 'Provider B draft', 'kitchen', 'fair', 40, 0, 'Morar', '', 'draft', null),
  ('10000000-0000-4000-a000-0000000000b2', '00000000-0000-4000-a000-0000000000c2', 'Provider B published', 'appliances', 'like_new', 80, 1000, 'Morar', '', 'published', null);

insert into public.product_images (product_id, storage_path, sort_order) values
  ('10000000-0000-4000-a000-0000000000a1', 'products/a1/0.webp', 0),
  ('10000000-0000-4000-a000-0000000000a2', 'products/a2/0.webp', 0);

insert into public.product_pickup_details (product_id, exact_address) values
  ('10000000-0000-4000-a000-0000000000a1', 'Test address A1, not real'),
  ('10000000-0000-4000-a000-0000000000a2', 'Test address A2, not real'),
  ('10000000-0000-4000-a000-0000000000b2', 'Test address B2, not real');

-- ---------------------------------------------------------------------------
-- Schema-level checks
-- ---------------------------------------------------------------------------
select pg_temp.expect(
  not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ),
  'RLS is enabled on every public table'
);

select pg_temp.expect(
  (select count(*) from public.profiles where id::text like '00000000-0000-4000-a000-%') = 8,
  'signup trigger created exactly one profile per user'
);

select pg_temp.expect(
  (select role from public.profiles where id = '00000000-0000-4000-a000-0000000000e1') = 'renter',
  'signup metadata requesting admin creates a renter'
);
select pg_temp.expect(
  (select role from public.profiles where id = '00000000-0000-4000-a000-0000000000c1') = 'provider',
  'signup metadata may request provider'
);
select pg_temp.expect(
  (select role from public.profiles where id = '00000000-0000-4000-a000-0000000000e2') = 'renter'
  and (select full_name from public.profiles where id = '00000000-0000-4000-a000-0000000000e2') = 'BorrowNest member',
  'invalid account type defaults to renter and blank name is replaced'
);
select pg_temp.expect(
  (select role from public.profiles where id = '00000000-0000-4000-a000-0000000000e3') = 'renter'
  and (select account_status from public.profiles where id = '00000000-0000-4000-a000-0000000000e3') = 'active',
  'missing metadata defaults to active renter'
);
select pg_temp.expect(
  (select full_name from public.profiles where id = '00000000-0000-4000-a000-0000000000e1') = '<img src=x onerror=alert(1)>',
  'HTML-looking names are stored verbatim as text (escaped at render time)'
);

-- ---------------------------------------------------------------------------
-- Anonymous visitor
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select pg_temp.expect_denied('select * from public.profiles', 'anon cannot read profiles');
select pg_temp.expect_denied('select * from public.products', 'anon cannot read the products table');
select pg_temp.expect_denied('select * from public.product_images', 'anon cannot read the product_images table');
select pg_temp.expect_denied('select * from public.product_pickup_details', 'anon cannot read pickup details');
select pg_temp.expect_denied(
  $$insert into public.products (provider_id, title, category, condition, price_per_day, area) values ('00000000-0000-4000-a000-0000000000c1', 'x', 'other', 'new', 1, 'Lashkar')$$,
  'anon cannot insert products'
);
select pg_temp.expect_denied('select private.is_active_admin()', 'anon cannot call private helpers');

select pg_temp.expect(
  (select count(*) from public.published_products() where id::text like '10000000-%') = 2,
  'anon catalogue returns only the two published listings'
);
select pg_temp.expect(
  not exists (select 1 from public.published_products() where title like '%draft%'),
  'anon catalogue never includes drafts'
);
select pg_temp.expect(
  (select count(*) from public.published_product_images() where product_id::text like '10000000-%') = 1,
  'anon image metadata is limited to published products'
);

reset role;

-- ---------------------------------------------------------------------------
-- Renter A
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);

select pg_temp.expect((select count(*) from public.profiles) = 1, 'renter A can see only their own profile');
select pg_temp.expect(
  not exists (select 1 from public.profiles where id = '00000000-0000-4000-a000-00000000000b'),
  'renter A cannot read renter B''s profile'
);

do $$
declare affected integer;
begin
  update public.profiles set full_name = 'Hijacked' where id = '00000000-0000-4000-a000-00000000000b';
  get diagnostics affected = row_count;
  perform pg_temp.expect(affected = 0, 'renter A cannot change renter B''s name');
end;
$$;

select pg_temp.expect_denied(
  $$update public.profiles set role = 'admin' where id = '00000000-0000-4000-a000-00000000000a'$$,
  'renter A cannot change their own role'
);
select pg_temp.expect_denied(
  $$update public.profiles set account_status = 'active' where id = '00000000-0000-4000-a000-00000000000a'$$,
  'renter A cannot change their own account status'
);
select pg_temp.expect_denied(
  $$update public.profiles set created_at = now() where id = '00000000-0000-4000-a000-00000000000a'$$,
  'renter A cannot change timestamps'
);
select pg_temp.expect_denied(
  $$insert into public.profiles (id, full_name, role) values ('00000000-0000-4000-a000-0000000000ff', 'Forged', 'admin')$$,
  'renter A cannot insert profiles'
);
select pg_temp.expect_denied(
  $$delete from public.profiles where id = '00000000-0000-4000-a000-00000000000a'$$,
  'renter A cannot delete profiles'
);

do $$
declare affected integer;
begin
  update public.profiles set full_name = 'Renter A Renamed' where id = '00000000-0000-4000-a000-00000000000a';
  get diagnostics affected = row_count;
  perform pg_temp.expect(affected = 1, 'renter A can update their own full name');
end;
$$;

select pg_temp.expect((select count(*) from public.products) = 0, 'renter A sees no rows in the products table');
select pg_temp.expect((select count(*) from public.product_pickup_details) = 0, 'renter A cannot read any pickup address');
select pg_temp.expect(
  (select count(*) from public.published_products() where id::text like '10000000-%') = 2,
  'renter A can browse the published catalogue'
);

reset role;

-- ---------------------------------------------------------------------------
-- Provider A
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000c1","role":"authenticated"}', true);

select pg_temp.expect(
  (select count(*) from public.products) = 2
  and not exists (select 1 from public.products where provider_id <> '00000000-0000-4000-a000-0000000000c1'),
  'provider A sees exactly their own two listings'
);
select pg_temp.expect(
  exists (select 1 from public.products where id = '10000000-0000-4000-a000-0000000000a1'),
  'provider A can read their own draft'
);
select pg_temp.expect(
  not exists (select 1 from public.products where id = '10000000-0000-4000-a000-0000000000b1'),
  'provider A cannot read provider B''s draft'
);
select pg_temp.expect(
  (select count(*) from public.product_pickup_details) = 2
  and not exists (select 1 from public.product_pickup_details where product_id = '10000000-0000-4000-a000-0000000000b2'),
  'provider A reads only their own pickup details'
);
select pg_temp.expect(
  (select count(*) from public.product_images) = 2,
  'provider A reads image metadata for their own products'
);
select pg_temp.expect((select count(*) from public.profiles) = 1, 'provider A cannot enumerate profiles');

select pg_temp.expect_denied(
  $$insert into public.products (provider_id, title, category, condition, price_per_day, area) values ('00000000-0000-4000-a000-0000000000c1', 'New item', 'other', 'new', 10, 'Lashkar')$$,
  'provider writes to products are denied in Stage 2'
);
select pg_temp.expect_denied(
  $$update public.products set listing_status = 'published' where id = '10000000-0000-4000-a000-0000000000a1'$$,
  'provider cannot publish their own listing'
);
select pg_temp.expect_denied(
  $$delete from public.products where id = '10000000-0000-4000-a000-0000000000a1'$$,
  'provider cannot delete products'
);
select pg_temp.expect_denied(
  $$insert into public.product_images (product_id, storage_path, sort_order) values ('10000000-0000-4000-a000-0000000000a1', 'x', 1)$$,
  'image metadata writes are denied in Stage 2'
);
select pg_temp.expect_denied(
  $$update public.product_pickup_details set exact_address = 'Changed address' where product_id = '10000000-0000-4000-a000-0000000000a1'$$,
  'pickup detail writes are denied in Stage 2'
);

reset role;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000ad","role":"authenticated"}', true);

select pg_temp.expect(
  (select count(*) from public.profiles where id::text like '00000000-0000-4000-a000-%') = 8,
  'active admin can inspect all profiles'
);
select pg_temp.expect(
  (select count(*) from public.products where id::text like '10000000-%') = 4,
  'active admin can inspect all listings, including drafts'
);
select pg_temp.expect(
  (select count(*) from public.product_pickup_details where product_id::text like '10000000-%') = 3,
  'active admin can read pickup details'
);
select pg_temp.expect_denied(
  $$update public.profiles set role = 'provider' where id = '00000000-0000-4000-a000-00000000000b'$$,
  'role changes are not available through the API, even for admins (deferred)'
);

reset role;

-- ---------------------------------------------------------------------------
-- Suspension takes effect immediately, without waiting for a new JWT
-- ---------------------------------------------------------------------------
update public.profiles set account_status = 'suspended' where id = '00000000-0000-4000-a000-0000000000c1';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000c1","role":"authenticated"}', true);

select pg_temp.expect((select count(*) from public.products) = 0, 'suspended provider loses access to their listings');
select pg_temp.expect((select count(*) from public.product_pickup_details) = 0, 'suspended provider loses access to pickup details');
select pg_temp.expect((select count(*) from public.product_images) = 0, 'suspended provider loses access to image metadata');
select pg_temp.expect((select count(*) from public.profiles) = 1, 'suspended user can still read their own profile status');

do $$
declare affected integer;
begin
  update public.profiles set full_name = 'Still here' where id = '00000000-0000-4000-a000-0000000000c1';
  get diagnostics affected = row_count;
  perform pg_temp.expect(affected = 0, 'suspended user cannot update their profile');
end;
$$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect(
  not exists (select 1 from public.published_products() where id = '10000000-0000-4000-a000-0000000000a2'),
  'listings from a suspended provider leave the public catalogue'
);
reset role;

update public.profiles set account_status = 'suspended' where id = '00000000-0000-4000-a000-0000000000ad';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000ad","role":"authenticated"}', true);
select pg_temp.expect((select count(*) from public.profiles) = 1, 'suspended admin loses admin profile access');
select pg_temp.expect((select count(*) from public.product_pickup_details) = 0, 'suspended admin loses pickup access');
reset role;

do $$ begin raise notice 'All boundary tests passed.'; end $$;

rollback;
