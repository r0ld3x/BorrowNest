-- BorrowNest Stage 4: admin moderation, account status, and audit trail.
--
-- Admins act only through the narrow SECURITY DEFINER functions below. Each
-- one re-checks that the caller is an ACTIVE admin from the current profile
-- row, locks its target, and appends an audit row in the same transaction.
-- Role promotion stays operator-only (supabase/operator/promote-admin.sql).

-- ---------------------------------------------------------------------------
-- Audit log: append-only for every application role.
-- ---------------------------------------------------------------------------
create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  -- Plain uuids, not foreign keys: history must survive account deletion.
  actor_id uuid not null,
  action text not null
    constraint admin_audit_action_allowed check (action in (
      'listing.approve', 'listing.reject', 'listing.edit',
      'account.suspend', 'account.restore'
    )),
  target_type text not null
    constraint admin_audit_target_type_allowed check (target_type in ('product', 'profile')),
  target_id uuid not null,
  reason text
    constraint admin_audit_reason_length check (char_length(reason) <= 500),
  -- Safe, bounded summary of what changed. Never addresses, emails,
  -- credentials, or full private records.
  summary jsonb not null default '{}'::jsonb
    constraint admin_audit_summary_size check (pg_column_size(summary) <= 8192),
  created_at timestamptz not null default pg_catalog.now()
);

create index admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);
create index admin_audit_logs_target_idx on public.admin_audit_logs (target_type, target_id, created_at desc);

alter table public.admin_audit_logs enable row level security;
revoke all on table public.admin_audit_logs from public, anon, authenticated;
grant select on table public.admin_audit_logs to authenticated;
grant select on table public.admin_audit_logs to service_role;

create policy "admin_audit_logs: active admins read"
  on public.admin_audit_logs for select
  to authenticated
  using ((select private.is_active_admin()));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.require_active_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not private.has_active_role('admin'::public.user_role) then
    raise exception 'BN:not_active_admin' using errcode = 'P0001';
  end if;
  return caller;
end;
$$;

-- Required, bounded admin reason (cleaned to one line).
create or replace function private.require_reason(p_reason text, p_min integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := private.clean_line(p_reason);
begin
  if char_length(cleaned) < p_min then
    raise exception 'BN:reason_required' using errcode = 'P0001';
  end if;
  if char_length(cleaned) > 500 then
    raise exception 'BN:reason_too_long' using errcode = 'P0001';
  end if;
  return cleaned;
end;
$$;

create or replace function private.write_audit(
  p_actor uuid, p_action text, p_target_type text, p_target_id uuid, p_reason text, p_summary jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit_logs (actor_id, action, target_type, target_id, reason, summary)
  values (p_actor, p_action, p_target_type, p_target_id, p_reason, coalesce(p_summary, '{}'::jsonb));
$$;

-- LIKE pattern from untrusted search text: escapes % _ and \, bounded length.
create or replace function private.search_pattern(p_search text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when char_length(private.clean_line(p_search)) = 0 then null
    else '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
           pg_catalog.left(private.clean_line(p_search), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;
$$;

revoke all on function private.require_active_admin() from public, anon, authenticated;
revoke all on function private.require_reason(text, integer) from public, anon, authenticated;
revoke all on function private.write_audit(uuid, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.search_pattern(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Listing moderation
-- ---------------------------------------------------------------------------
-- p_expected_updated_at is the version the admin reviewed. If the provider
-- changed the listing since, the decision is refused as stale.
create or replace function public.moderate_listing(
  p_product_id uuid,
  p_decision text,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns public.listing_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_active_admin();
  product public.products;
  pickup public.product_pickup_details;
  v_reason text;
begin
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'BN:invalid_decision' using errcode = 'P0001';
  end if;

  select * into product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'BN:listing_not_found' using errcode = 'P0001';
  end if;

  -- Repeating a decision that already took effect is a no-op: no second
  -- audit row.
  if (p_decision = 'approve' and product.listing_status = 'published')
     or (p_decision = 'reject' and product.listing_status = 'rejected') then
    return product.listing_status;
  end if;

  if product.listing_status <> 'pending_review' then
    raise exception 'BN:invalid_transition' using errcode = 'P0001';
  end if;
  if p_expected_updated_at is null or product.updated_at <> p_expected_updated_at then
    raise exception 'BN:stale_listing' using errcode = 'P0001';
  end if;

  if p_decision = 'reject' then
    v_reason := private.require_reason(p_reason, 10);
    update public.products
    set listing_status = 'rejected', moderation_reason = v_reason,
        moderated_by = caller, moderated_at = pg_catalog.now()
    where id = product.id;
    perform private.write_audit(caller, 'listing.reject', 'product', product.id, v_reason,
      jsonb_build_object('from', product.listing_status, 'to', 'rejected', 'title', product.title));
    return 'rejected';
  end if;

  -- Approve: re-verify everything that publication depends on.
  select * into pickup from public.product_pickup_details where product_id = product.id;
  begin
    perform private.assert_listing_input(
      product.title, product.description, product.category, product.condition,
      product.price_per_day, product.deposit, product.area, product.landmark,
      coalesce(pickup.exact_address, ''), coalesce(pickup.pickup_instructions, ''));
  exception when others then
    raise exception 'BN:listing_incomplete' using errcode = 'P0001';
  end;
  if char_length(product.description) < 20
     or not exists (select 1 from public.product_images where product_id = product.id)
     or product.city <> 'Gwalior' then
    raise exception 'BN:listing_incomplete' using errcode = 'P0001';
  end if;
  if not private.is_eligible_provider(product.provider_id) then
    raise exception 'BN:provider_not_active' using errcode = 'P0001';
  end if;

  v_reason := nullif(private.clean_line(p_reason), '');
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'BN:reason_too_long' using errcode = 'P0001';
  end if;

  update public.products
  set listing_status = 'published', moderation_reason = null,
      moderated_by = caller, moderated_at = pg_catalog.now()
  where id = product.id;
  perform private.write_audit(caller, 'listing.approve', 'product', product.id, v_reason,
    jsonb_build_object('from', product.listing_status, 'to', 'published', 'title', product.title,
                       'price_per_day', product.price_per_day, 'deposit', product.deposit));
  return 'published';
end;
$$;

-- Admin content correction. Only public text fields; never price, deposit,
-- owner, address, or status. Existing (future) bookings keep their own
-- price snapshots, so nothing historical can change here.
create or replace function public.admin_edit_listing(
  p_product_id uuid,
  p_expected_updated_at timestamptz,
  p_title text, p_description text, p_category text, p_condition text,
  p_area text, p_landmark text,
  p_reason text
)
returns public.listing_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_active_admin();
  product public.products;
  v_reason text := private.require_reason(p_reason, 10);
  v_title text := private.clean_line(p_title);
  v_description text := private.clean_block(p_description);
  v_area text := private.clean_line(p_area);
  v_landmark text := private.clean_line(p_landmark);
  before_values jsonb := '{}';
  after_values jsonb := '{}';
begin
  select * into product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'BN:listing_not_found' using errcode = 'P0001';
  end if;
  if product.listing_status = 'archived' then
    raise exception 'BN:listing_archived' using errcode = 'P0001';
  end if;
  if p_expected_updated_at is null or product.updated_at <> p_expected_updated_at then
    raise exception 'BN:stale_listing' using errcode = 'P0001';
  end if;

  -- Same rules as provider input; price/deposit/address are passed through
  -- unchanged purely to reuse the validator.
  perform private.assert_listing_input(
    v_title, v_description, p_category, p_condition,
    product.price_per_day, product.deposit, v_area, v_landmark, 'unchanged', '');

  if product.title is distinct from v_title then
    before_values := before_values || jsonb_build_object('title', product.title);
    after_values := after_values || jsonb_build_object('title', v_title);
  end if;
  if product.description is distinct from v_description then
    before_values := before_values || jsonb_build_object('description', pg_catalog.left(product.description, 300));
    after_values := after_values || jsonb_build_object('description', pg_catalog.left(v_description, 300));
  end if;
  if product.category is distinct from p_category then
    before_values := before_values || jsonb_build_object('category', product.category);
    after_values := after_values || jsonb_build_object('category', p_category);
  end if;
  if product.condition is distinct from p_condition then
    before_values := before_values || jsonb_build_object('condition', product.condition);
    after_values := after_values || jsonb_build_object('condition', p_condition);
  end if;
  if product.area is distinct from v_area then
    before_values := before_values || jsonb_build_object('area', product.area);
    after_values := after_values || jsonb_build_object('area', v_area);
  end if;
  if product.landmark is distinct from v_landmark then
    before_values := before_values || jsonb_build_object('landmark', product.landmark);
    after_values := after_values || jsonb_build_object('landmark', v_landmark);
  end if;

  if after_values = '{}'::jsonb then
    return product.listing_status; -- nothing changed, nothing to audit
  end if;

  update public.products
  set title = v_title, description = v_description, category = p_category,
      condition = p_condition, area = v_area, landmark = v_landmark
  where id = product.id;

  perform private.write_audit(caller, 'listing.edit', 'product', product.id, v_reason,
    jsonb_build_object('before', before_values, 'after', after_values, 'status', product.listing_status));
  return product.listing_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Account suspension
-- ---------------------------------------------------------------------------
-- All account-status changes take one transaction-scoped advisory lock, so
-- two admins suspending each other at once are serialized: the second one
-- re-checks and finds its own account already suspended.
create or replace function private.set_account_status(
  p_profile_id uuid, p_status public.account_status, p_reason text
)
returns public.account_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid;
  target public.profiles;
  v_reason text;
  other_active_admins integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('borrownest.account_status'));
  caller := private.require_active_admin(); -- checked after the lock, on purpose

  v_reason := private.require_reason(p_reason, 10);

  select * into target from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'BN:account_not_found' using errcode = 'P0001';
  end if;

  if target.account_status = p_status then
    return target.account_status; -- idempotent repeat, no audit row
  end if;

  if p_status = 'suspended' then
    if target.id = caller then
      raise exception 'BN:cannot_suspend_self' using errcode = 'P0001';
    end if;
    if target.role = 'admin' then
      select count(*) into other_active_admins
      from public.profiles
      where role = 'admin' and account_status = 'active' and id <> target.id;
      if other_active_admins = 0 then
        raise exception 'BN:last_active_admin' using errcode = 'P0001';
      end if;
    end if;
  end if;

  update public.profiles set account_status = p_status where id = target.id;

  perform private.write_audit(caller,
    case when p_status = 'suspended' then 'account.suspend' else 'account.restore' end,
    'profile', target.id, v_reason,
    jsonb_build_object('from', target.account_status, 'to', p_status, 'role', target.role,
                       'name', target.full_name));
  return p_status;
end;
$$;
revoke all on function private.set_account_status(uuid, public.account_status, text) from public, anon, authenticated;

create or replace function public.suspend_account(p_profile_id uuid, p_reason text)
returns public.account_status
language sql
security definer
set search_path = ''
as $$
  select private.set_account_status(p_profile_id, 'suspended', p_reason);
$$;

create or replace function public.restore_account(p_profile_id uuid, p_reason text)
returns public.account_status
language sql
security definer
set search_path = ''
as $$
  select private.set_account_status(p_profile_id, 'active', p_reason);
$$;

-- ---------------------------------------------------------------------------
-- Admin read functions: explicit columns, bounded pages, escaped search.
-- ---------------------------------------------------------------------------
create or replace function public.admin_overview()
returns table (
  pending_review bigint, published bigint, rejected bigint, total_listings bigint,
  accounts bigint, suspended_accounts bigint, providers bigint, renters bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_active_admin();
  return query
  select
    (select count(*) from public.products where listing_status = 'pending_review'),
    (select count(*) from public.products where listing_status = 'published'),
    (select count(*) from public.products where listing_status = 'rejected'),
    (select count(*) from public.products),
    (select count(*) from public.profiles),
    (select count(*) from public.profiles where account_status = 'suspended'),
    (select count(*) from public.profiles where role = 'provider'),
    (select count(*) from public.profiles where role = 'renter');
end;
$$;

create or replace function public.admin_list_listings(
  p_status public.listing_status, p_search text, p_limit integer, p_offset integer
)
returns table (
  id uuid, title text, category text, area text, price_per_day numeric, deposit numeric,
  listing_status public.listing_status, updated_at timestamptz,
  provider_id uuid, provider_name text, provider_status public.account_status,
  image_count bigint, cover_path text, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pattern text := private.search_pattern(p_search);
  page_size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  page_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  perform private.require_active_admin();
  return query
  select p.id, p.title, p.category, p.area, p.price_per_day, p.deposit,
         p.listing_status, p.updated_at,
         p.provider_id, pr.full_name, pr.account_status,
         (select count(*) from public.product_images i where i.product_id = p.id),
         (select i.storage_path from public.product_images i where i.product_id = p.id order by i.sort_order limit 1),
         count(*) over ()
  from public.products p
  join public.profiles pr on pr.id = p.provider_id
  where (p_status is null or p.listing_status = p_status)
    and (pattern is null or p.title ilike pattern or p.area ilike pattern or pr.full_name ilike pattern)
  order by case when p.listing_status = 'pending_review' then p.updated_at end asc nulls last,
           p.updated_at desc, p.id
  limit page_size offset page_offset;
end;
$$;

-- Email comes from Auth for admin account management. No credentials,
-- tokens, or other Auth internals are returned.
create or replace function public.admin_list_accounts(
  p_search text, p_limit integer, p_offset integer
)
returns table (
  id uuid, full_name text, email text, role public.user_role,
  account_status public.account_status, created_at timestamptz,
  listing_count bigint, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pattern text := private.search_pattern(p_search);
  page_size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  page_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  perform private.require_active_admin();
  return query
  select pr.id, pr.full_name, u.email::text, pr.role, pr.account_status, pr.created_at,
         (select count(*) from public.products p where p.provider_id = pr.id),
         count(*) over ()
  from public.profiles pr
  left join auth.users u on u.id = pr.id
  where pattern is null or pr.full_name ilike pattern or u.email ilike pattern
  order by pr.created_at desc, pr.id
  limit page_size offset page_offset;
end;
$$;

create or replace function public.admin_list_audit(
  p_target_id uuid, p_limit integer, p_offset integer
)
returns table (
  id uuid, action text, target_type text, target_id uuid, reason text, summary jsonb,
  created_at timestamptz, actor_id uuid, actor_name text, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page_size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  page_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  perform private.require_active_admin();
  return query
  select a.id, a.action, a.target_type, a.target_id, a.reason, a.summary, a.created_at,
         a.actor_id, pr.full_name, count(*) over ()
  from public.admin_audit_logs a
  left join public.profiles pr on pr.id = a.actor_id
  where p_target_id is null or a.target_id = p_target_id
  order by a.created_at desc, a.id
  limit page_size offset page_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- Execution privileges: signed-in callers only; each function checks admin.
-- ---------------------------------------------------------------------------
revoke all on function public.moderate_listing(uuid, text, text, timestamptz) from public, anon;
revoke all on function public.admin_edit_listing(uuid, timestamptz, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.suspend_account(uuid, text) from public, anon;
revoke all on function public.restore_account(uuid, text) from public, anon;
revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_list_listings(public.listing_status, text, integer, integer) from public, anon;
revoke all on function public.admin_list_accounts(text, integer, integer) from public, anon;
revoke all on function public.admin_list_audit(uuid, integer, integer) from public, anon;

grant execute on function public.moderate_listing(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.admin_edit_listing(uuid, timestamptz, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.suspend_account(uuid, text) to authenticated;
grant execute on function public.restore_account(uuid, text) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_list_listings(public.listing_status, text, integer, integer) to authenticated;
grant execute on function public.admin_list_accounts(text, integer, integer) to authenticated;
grant execute on function public.admin_list_audit(uuid, integer, integer) to authenticated;
