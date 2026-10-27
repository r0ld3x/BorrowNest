-- BorrowNest Stage 2: public catalogue read functions.
--
-- Visitors never get privileges on the base tables. These SECURITY DEFINER
-- functions return an explicit list of safe columns for published listings
-- whose provider is currently an active provider. Moderation notes,
-- moderator identity, provider identity, and pickup details are never
-- returned. PostgREST still allows filtering and ordering on the result,
-- for example: /rest/v1/rpc/published_products?category=eq.bicycles

create or replace function public.published_products()
returns table (
  id uuid,
  title text,
  description text,
  category text,
  condition text,
  price_per_day numeric(10, 2),
  deposit numeric(10, 2),
  city text,
  area text,
  landmark text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.title, p.description, p.category, p.condition,
         p.price_per_day, p.deposit, p.city, p.area, p.landmark, p.created_at
  from public.products p
  where p.listing_status = 'published'
    and private.is_eligible_provider(p.provider_id);
$$;

create or replace function public.published_product_images()
returns table (
  id uuid,
  product_id uuid,
  storage_path text,
  sort_order smallint,
  caption text
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.product_id, i.storage_path, i.sort_order, i.caption
  from public.product_images i
  join public.products p on p.id = i.product_id
  where p.listing_status = 'published'
    and private.is_eligible_provider(p.provider_id);
$$;

revoke all on function public.published_products() from public;
revoke all on function public.published_product_images() from public;
grant execute on function public.published_products() to anon, authenticated, service_role;
grant execute on function public.published_product_images() to anon, authenticated, service_role;
