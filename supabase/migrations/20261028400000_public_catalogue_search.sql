-- BorrowNest Stage 5: public catalogue search and detail.
--
-- Visitors still have no table privileges. These SECURITY DEFINER functions
-- return explicit, safe columns for published listings whose provider is an
-- active provider, so a suspension or unpublish takes effect on the next
-- query. Never returned: pickup details, moderation fields, provider id,
-- email, full name, or account status. The only provider detail exposed is
-- a first name ("Listed by Rahul").

create or replace function private.public_first_name(full_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.left(pg_catalog.split_part(private.clean_line(full_name), ' ', 1), 40), '');
$$;
revoke all on function private.public_first_name(text) from public, anon, authenticated;

-- Indexes for the catalogue's filters and sorts (published rows only).
create index if not exists products_published_price_idx
  on public.products (price_per_day, id) where listing_status = 'published';
create index if not exists products_published_recent_idx
  on public.products (moderated_at desc, id) where listing_status = 'published';
create index if not exists product_images_cover_idx
  on public.product_images (product_id, sort_order);

create or replace function public.search_published_products(
  p_query text,
  p_category text,
  p_area text,
  p_min_price numeric,
  p_max_price numeric,
  p_sort text,
  p_limit integer,
  p_offset integer
)
returns table (
  id uuid, title text, category text, condition text,
  price_per_day numeric, deposit numeric, area text, landmark text,
  cover_path text, image_count bigint, listed_by text, published_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pattern text := private.search_pattern(p_query);
  v_area text := nullif(private.clean_line(p_area), '');
  v_sort text := case when p_sort in ('newest', 'price_asc', 'price_desc') then p_sort else 'newest' end;
  page_size integer := least(greatest(coalesce(p_limit, 12), 1), 48);
  page_offset integer := least(greatest(coalesce(p_offset, 0), 0), 5000);
begin
  return query
  select p.id, p.title, p.category, p.condition, p.price_per_day, p.deposit, p.area, p.landmark,
         (select i.storage_path from public.product_images i where i.product_id = p.id order by i.sort_order limit 1),
         (select count(*) from public.product_images i where i.product_id = p.id),
         private.public_first_name(pr.full_name),
         p.moderated_at,
         count(*) over ()
  from public.products p
  join public.profiles pr on pr.id = p.provider_id
  where p.listing_status = 'published'
    and pr.role = 'provider' and pr.account_status = 'active'
    and (pattern is null or p.title ilike pattern or p.description ilike pattern or p.area ilike pattern)
    and (p_category is null or p.category = p_category)
    and (v_area is null or lower(p.area) = lower(v_area))
    and (p_min_price is null or p.price_per_day >= p_min_price)
    and (p_max_price is null or p.price_per_day <= p_max_price)
  order by
    case when v_sort = 'price_asc' then p.price_per_day end asc,
    case when v_sort = 'price_desc' then p.price_per_day end desc,
    p.moderated_at desc nulls last,
    p.id
  limit page_size offset page_offset;
end;
$$;

create or replace function public.get_published_product(p_product_id uuid)
returns table (
  id uuid, title text, description text, category text, condition text,
  price_per_day numeric, deposit numeric, city text, area text, landmark text,
  listed_by text, published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.title, p.description, p.category, p.condition,
         p.price_per_day, p.deposit, p.city, p.area, p.landmark,
         private.public_first_name(pr.full_name), p.moderated_at
  from public.products p
  join public.profiles pr on pr.id = p.provider_id
  where p.id = p_product_id
    and p.listing_status = 'published'
    and pr.role = 'provider' and pr.account_status = 'active';
$$;

create or replace function public.get_published_product_images(p_product_id uuid)
returns table (id uuid, storage_path text, sort_order smallint, caption text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.storage_path, i.sort_order, i.caption
  from public.product_images i
  join public.products p on p.id = i.product_id
  join public.profiles pr on pr.id = p.provider_id
  where i.product_id = p_product_id
    and p.listing_status = 'published'
    and pr.role = 'provider' and pr.account_status = 'active'
  order by i.sort_order;
$$;

-- Areas that currently have at least one public listing, for the filter.
create or replace function public.published_areas()
returns table (area text, listing_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select min(p.area), count(*)
  from public.products p
  join public.profiles pr on pr.id = p.provider_id
  where p.listing_status = 'published'
    and pr.role = 'provider' and pr.account_status = 'active'
  group by lower(p.area)
  order by min(p.area)
  limit 200;
$$;

revoke all on function public.search_published_products(text, text, text, numeric, numeric, text, integer, integer) from public;
revoke all on function public.get_published_product(uuid) from public;
revoke all on function public.get_published_product_images(uuid) from public;
revoke all on function public.published_areas() from public;
grant execute on function public.search_published_products(text, text, text, numeric, numeric, text, integer, integer) to anon, authenticated, service_role;
grant execute on function public.get_published_product(uuid) to anon, authenticated, service_role;
grant execute on function public.get_published_product_images(uuid) to anon, authenticated, service_role;
grant execute on function public.published_areas() to anon, authenticated, service_role;
