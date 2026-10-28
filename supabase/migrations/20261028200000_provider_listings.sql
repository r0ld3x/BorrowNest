-- BorrowNest Stage 3: provider listing management.
--
-- Providers never get table write privileges. Every change goes through a
-- narrow SECURITY DEFINER function that:
--   * derives the provider from auth.uid() and requires an active provider,
--   * accepts only whitelisted content columns (never provider_id, status,
--     or moderation fields),
--   * locks the product row so concurrent changes serialize,
--   * raises 'BN:<code>' errors that the app maps to fixed messages.
-- Publication itself is an admin decision (Stage 4).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.require_active_provider()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not private.has_active_role('provider'::public.user_role) then
    raise exception 'BN:not_active_provider' using errcode = 'P0001';
  end if;
  return caller;
end;
$$;

-- Single-line text: strip control characters, collapse whitespace, trim.
create or replace function private.clean_line(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(coalesce(value, ''), '[[:cntrl:]]', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

-- Multi-line text: keep line breaks, drop other control characters, trim.
create or replace function private.clean_block(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(coalesce(value, ''), E'\r\n?', E'\n', 'g'),
    E'[\\x01-\\x09\\x0B-\\x1F\\x7F]', '', 'g'));
$$;

create or replace function private.assert_listing_input(
  p_title text, p_description text, p_category text, p_condition text,
  p_price_per_day numeric, p_deposit numeric, p_area text, p_landmark text,
  p_exact_address text, p_pickup_instructions text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if char_length(p_title) not between 3 and 120 then
    raise exception 'BN:invalid_title' using errcode = 'P0001';
  end if;
  if char_length(p_description) > 2000 then
    raise exception 'BN:invalid_description' using errcode = 'P0001';
  end if;
  if p_category is null or p_category not in
     ('furniture', 'appliances', 'bicycles', 'study_essentials', 'kitchen', 'other') then
    raise exception 'BN:invalid_category' using errcode = 'P0001';
  end if;
  if p_condition is null or p_condition not in ('new', 'like_new', 'good', 'fair') then
    raise exception 'BN:invalid_condition' using errcode = 'P0001';
  end if;
  -- Reject rather than round: at most two decimal places.
  if p_price_per_day is null or p_price_per_day <= 0 or p_price_per_day > 50000
     or p_price_per_day <> round(p_price_per_day, 2) then
    raise exception 'BN:invalid_price' using errcode = 'P0001';
  end if;
  if p_deposit is null or p_deposit < 0 or p_deposit > 500000
     or p_deposit <> round(p_deposit, 2) then
    raise exception 'BN:invalid_deposit' using errcode = 'P0001';
  end if;
  if char_length(p_area) not between 2 and 80 then
    raise exception 'BN:invalid_area' using errcode = 'P0001';
  end if;
  if char_length(p_landmark) > 120 then
    raise exception 'BN:invalid_landmark' using errcode = 'P0001';
  end if;
  if char_length(p_exact_address) not between 5 and 500 then
    raise exception 'BN:invalid_address' using errcode = 'P0001';
  end if;
  if char_length(p_pickup_instructions) > 1000 then
    raise exception 'BN:invalid_pickup_instructions' using errcode = 'P0001';
  end if;
end;
$$;

-- Locks and returns the caller's own product. Another provider's product
-- and a missing one fail identically, so ids cannot be probed.
create or replace function private.lock_own_product(p_product_id uuid)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_active_provider();
  product public.products;
begin
  select * into product
  from public.products
  where id = p_product_id and provider_id = caller
  for update;

  if not found then
    raise exception 'BN:listing_not_found' using errcode = 'P0001';
  end if;
  return product;
end;
$$;

-- Content changes to an approved listing send it back to review and clear
-- the now-obsolete approval. (The admin audit log arrives in Stage 4.)
create or replace function private.mark_content_changed(p_product_id uuid)
returns public.listing_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_status public.listing_status;
begin
  update public.products
  set listing_status = case
        when listing_status in ('published', 'paused') then 'pending_review'::public.listing_status
        else listing_status
      end,
      moderation_reason = case
        when listing_status in ('published', 'paused') then null else moderation_reason
      end,
      moderated_by = case
        when listing_status in ('published', 'paused') then null else moderated_by
      end,
      moderated_at = case
        when listing_status in ('published', 'paused') then null else moderated_at
      end
  where id = p_product_id
  returning listing_status into next_status;
  return next_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Listing lifecycle (provider side)
-- ---------------------------------------------------------------------------
create or replace function public.create_listing_draft(
  p_title text, p_description text, p_category text, p_condition text,
  p_price_per_day numeric, p_deposit numeric, p_area text, p_landmark text,
  p_exact_address text, p_pickup_instructions text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_active_provider();
  v_title text := private.clean_line(p_title);
  v_description text := private.clean_block(p_description);
  v_area text := private.clean_line(p_area);
  v_landmark text := private.clean_line(p_landmark);
  v_address text := private.clean_block(p_exact_address);
  v_instructions text := private.clean_block(p_pickup_instructions);
  new_id uuid;
begin
  perform private.assert_listing_input(
    v_title, v_description, p_category, p_condition, p_price_per_day, p_deposit,
    v_area, v_landmark, v_address, v_instructions);

  -- City, status, and owner are set here, never by the caller.
  insert into public.products (
    provider_id, title, description, category, condition,
    price_per_day, deposit, city, area, landmark, listing_status
  ) values (
    caller, v_title, v_description, p_category, p_condition,
    p_price_per_day, p_deposit, 'Gwalior', v_area, v_landmark, 'draft'
  )
  returning id into new_id;

  insert into public.product_pickup_details (product_id, exact_address, pickup_instructions)
  values (new_id, v_address, v_instructions);

  return new_id;
end;
$$;

create or replace function public.update_listing(
  p_product_id uuid,
  p_title text, p_description text, p_category text, p_condition text,
  p_price_per_day numeric, p_deposit numeric, p_area text, p_landmark text,
  p_exact_address text, p_pickup_instructions text
)
returns public.listing_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  product public.products := private.lock_own_product(p_product_id);
  v_title text := private.clean_line(p_title);
  v_description text := private.clean_block(p_description);
  v_area text := private.clean_line(p_area);
  v_landmark text := private.clean_line(p_landmark);
  v_address text := private.clean_block(p_exact_address);
  v_instructions text := private.clean_block(p_pickup_instructions);
  pickup public.product_pickup_details;
  changed boolean;
begin
  if product.listing_status = 'archived' then
    raise exception 'BN:listing_archived' using errcode = 'P0001';
  end if;

  perform private.assert_listing_input(
    v_title, v_description, p_category, p_condition, p_price_per_day, p_deposit,
    v_area, v_landmark, v_address, v_instructions);

  select * into pickup from public.product_pickup_details where product_id = product.id;

  changed := product.title is distinct from v_title
    or product.description is distinct from v_description
    or product.category is distinct from p_category
    or product.condition is distinct from p_condition
    or product.price_per_day is distinct from p_price_per_day
    or product.deposit is distinct from p_deposit
    or product.area is distinct from v_area
    or product.landmark is distinct from v_landmark
    or pickup.exact_address is distinct from v_address
    or pickup.pickup_instructions is distinct from v_instructions;

  if not changed then
    return product.listing_status;
  end if;

  update public.products
  set title = v_title, description = v_description, category = p_category,
      condition = p_condition, price_per_day = p_price_per_day, deposit = p_deposit,
      area = v_area, landmark = v_landmark
  where id = product.id;

  insert into public.product_pickup_details (product_id, exact_address, pickup_instructions)
  values (product.id, v_address, v_instructions)
  on conflict (product_id) do update
    set exact_address = excluded.exact_address,
        pickup_instructions = excluded.pickup_instructions;

  return private.mark_content_changed(product.id);
end;
$$;

create or replace function public.submit_listing(p_product_id uuid)
returns public.listing_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  product public.products := private.lock_own_product(p_product_id);
begin
  if product.listing_status = 'pending_review' then
    return product.listing_status; -- idempotent repeat
  end if;
  if product.listing_status not in ('draft', 'rejected') then
    raise exception 'BN:invalid_transition' using errcode = 'P0001';
  end if;
  if char_length(product.description) < 20 then
    raise exception 'BN:description_too_short' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.product_pickup_details where product_id = product.id) then
    raise exception 'BN:missing_pickup_details' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.product_images where product_id = product.id) then
    raise exception 'BN:missing_images' using errcode = 'P0001';
  end if;

  update public.products
  set listing_status = 'pending_review',
      moderation_reason = null, moderated_by = null, moderated_at = null
  where id = product.id;
  return 'pending_review';
end;
$$;

create or replace function public.pause_listing(p_product_id uuid)
returns public.listing_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  product public.products := private.lock_own_product(p_product_id);
begin
  if product.listing_status = 'paused' then
    return product.listing_status;
  end if;
  if product.listing_status <> 'published' then
    raise exception 'BN:invalid_transition' using errcode = 'P0001';
  end if;
  update public.products set listing_status = 'paused' where id = product.id;
  return 'paused';
end;
$$;

-- A paused listing always holds admin-approved content: any edit while
-- paused sends it to pending_review instead (mark_content_changed).
create or replace function public.resume_listing(p_product_id uuid)
returns public.listing_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  product public.products := private.lock_own_product(p_product_id);
begin
  if product.listing_status = 'published' then
    return product.listing_status;
  end if;
  if product.listing_status <> 'paused' then
    raise exception 'BN:invalid_transition' using errcode = 'P0001';
  end if;
  update public.products set listing_status = 'published' where id = product.id;
  return 'published';
end;
$$;

-- Archiving hides the listing; it keeps the row, images, and history.
create or replace function public.archive_listing(p_product_id uuid)
returns public.listing_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  product public.products := private.lock_own_product(p_product_id);
begin
  if product.listing_status <> 'archived' then
    update public.products set listing_status = 'archived' where id = product.id;
  end if;
  return 'archived';
end;
$$;

-- ---------------------------------------------------------------------------
-- Execution privileges: signed-in users only; each function checks the role.
-- ---------------------------------------------------------------------------
revoke all on function private.require_active_provider() from public, anon, authenticated;
revoke all on function private.clean_line(text) from public, anon, authenticated;
revoke all on function private.clean_block(text) from public, anon, authenticated;
revoke all on function private.assert_listing_input(text, text, text, text, numeric, numeric, text, text, text, text) from public, anon, authenticated;
revoke all on function private.lock_own_product(uuid) from public, anon, authenticated;
revoke all on function private.mark_content_changed(uuid) from public, anon, authenticated;

revoke all on function public.create_listing_draft(text, text, text, text, numeric, numeric, text, text, text, text) from public, anon;
revoke all on function public.update_listing(uuid, text, text, text, text, numeric, numeric, text, text, text, text) from public, anon;
revoke all on function public.submit_listing(uuid) from public, anon;
revoke all on function public.pause_listing(uuid) from public, anon;
revoke all on function public.resume_listing(uuid) from public, anon;
revoke all on function public.archive_listing(uuid) from public, anon;

grant execute on function public.create_listing_draft(text, text, text, text, numeric, numeric, text, text, text, text) to authenticated;
grant execute on function public.update_listing(uuid, text, text, text, text, numeric, numeric, text, text, text, text) to authenticated;
grant execute on function public.submit_listing(uuid) to authenticated;
grant execute on function public.pause_listing(uuid) to authenticated;
grant execute on function public.resume_listing(uuid) to authenticated;
grant execute on function public.archive_listing(uuid) to authenticated;
