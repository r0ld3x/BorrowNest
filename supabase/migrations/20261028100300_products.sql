-- BorrowNest Stage 2: product catalogue tables and access rules.
-- Provider writes and uploads arrive in Stage 3; until then every API write
-- is denied by the absence of privileges and policies.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles (id) on delete restrict,
  title text not null
    constraint products_title_length check (char_length(title) between 3 and 120),
  description text not null default ''
    constraint products_description_length check (char_length(description) <= 2000),
  category text not null
    constraint products_category_allowed check (
      category in ('furniture', 'appliances', 'bicycles', 'study_essentials', 'kitchen', 'other')
    ),
  condition text not null
    constraint products_condition_allowed check (
      condition in ('new', 'like_new', 'good', 'fair')
    ),
  price_per_day numeric(10, 2) not null
    constraint products_price_positive check (price_per_day > 0),
  deposit numeric(10, 2) not null default 0
    constraint products_deposit_nonnegative check (deposit >= 0),
  city text not null default 'Gwalior'
    constraint products_city_gwalior check (city = 'Gwalior'),
  area text not null
    constraint products_area_length check (char_length(area) between 2 and 80),
  landmark text not null default ''
    constraint products_landmark_length check (char_length(landmark) <= 120),
  listing_status public.listing_status not null default 'draft',
  -- Moderation fields are private: never returned by the public catalogue.
  moderation_reason text
    constraint products_moderation_reason_length check (char_length(moderation_reason) <= 500),
  moderated_by uuid references public.profiles (id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create index products_provider_id_idx on public.products (provider_id);
create index products_published_browse_idx
  on public.products (category, area)
  where listing_status = 'published';

create trigger products_set_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null
    constraint product_images_storage_path_length check (char_length(storage_path) between 1 and 512),
  sort_order smallint not null
    constraint product_images_sort_order_range check (sort_order between 0 and 19),
  caption text
    constraint product_images_caption_length check (char_length(caption) <= 200),
  created_at timestamptz not null default pg_catalog.now(),
  -- Also serves as the product_id lookup index (leading column).
  constraint product_images_product_sort_unique unique (product_id, sort_order)
);

-- Exact pickup information is kept apart from public product rows.
create table public.product_pickup_details (
  product_id uuid primary key references public.products (id) on delete cascade,
  exact_address text not null
    constraint pickup_exact_address_length check (char_length(exact_address) between 5 and 500),
  pickup_instructions text not null default ''
    constraint pickup_instructions_length check (char_length(pickup_instructions) <= 1000),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create trigger product_pickup_details_set_updated_at
  before update on public.product_pickup_details
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges: read-only for signed-in users (rows filtered by RLS), nothing
-- for anon. Public catalogue access goes through the functions below.
-- ---------------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_pickup_details enable row level security;

revoke all on table public.products from public, anon, authenticated;
revoke all on table public.product_images from public, anon, authenticated;
revoke all on table public.product_pickup_details from public, anon, authenticated;

grant select on table public.products to authenticated;
grant select on table public.product_images to authenticated;
grant select on table public.product_pickup_details to authenticated;

grant select, insert, update, delete on table public.products to service_role;
grant select, insert, update, delete on table public.product_images to service_role;
grant select, insert, update, delete on table public.product_pickup_details to service_role;

-- products
create policy "products: active providers read own"
  on public.products for select
  to authenticated
  using (provider_id = (select auth.uid()) and (select private.is_active_provider()));

create policy "products: active admins read all"
  on public.products for select
  to authenticated
  using ((select private.is_active_admin()));

-- product_images (the subquery on products is itself RLS-filtered)
create policy "product_images: active providers read own"
  on public.product_images for select
  to authenticated
  using (
    (select private.is_active_provider())
    and exists (
      select 1 from public.products p
      where p.id = product_images.product_id
        and p.provider_id = (select auth.uid())
    )
  );

create policy "product_images: active admins read all"
  on public.product_images for select
  to authenticated
  using ((select private.is_active_admin()));

-- product_pickup_details: owner and admins only. Confirmed-booking access
-- for renters is added in a later stage.
create policy "pickup_details: active providers read own"
  on public.product_pickup_details for select
  to authenticated
  using (
    (select private.is_active_provider())
    and exists (
      select 1 from public.products p
      where p.id = product_pickup_details.product_id
        and p.provider_id = (select auth.uid())
    )
  );

create policy "pickup_details: active admins read all"
  on public.product_pickup_details for select
  to authenticated
  using ((select private.is_active_admin()));
