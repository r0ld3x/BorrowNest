-- BorrowNest Stage 3: product photos in Supabase Storage.
--
-- Bucket: public, because published product photography is intentionally
-- public. LIMITATION: anyone holding an object URL can still load it after
-- a listing is hidden or archived; URLs use random object ids and are not
-- listable, but they are not secret. Condition and dispute evidence (later
-- stages) must use separate PRIVATE buckets, never this one.
--
-- Trust model for image bytes: Postgres cannot decode images, so the app
-- server decodes and re-encodes every upload (JPEG/PNG/WebP in, WebP out,
-- metadata stripped) and then signs the object path with an HMAC key that
-- lives in Supabase Vault and in a server-only environment variable.
-- attach_product_image() only accepts signed paths, so objects uploaded
-- directly through the Storage API can never become listing images.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 5242880, array['image/webp'])
on conflict (id) do nothing;

-- Paths ever attached to a listing. Prevents re-attaching a path whose
-- object was deleted and replaced with unverified bytes.
create table private.attached_image_paths (
  storage_path text primary key,
  product_id uuid not null,
  attached_at timestamptz not null default pg_catalog.now()
);
revoke all on table private.attached_image_paths from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage policy helpers
-- ---------------------------------------------------------------------------

-- Object names must be exactly <provider uuid>/<product uuid>/<random uuid>.webp
create or replace function private.photo_path_parts(object_name text)
returns table (provider_id uuid, product_id uuid)
language sql
immutable
set search_path = ''
as $$
  select split_part(object_name, '/', 1)::uuid, split_part(object_name, '/', 2)::uuid
  where object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$';
$$;

-- Upload allowed only into the caller's own folder, for a product the
-- caller owns that is not archived, while the caller is an active provider.
create or replace function private.can_upload_product_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_provider() and exists (
    select 1
    from private.photo_path_parts(object_name) parts
    join public.products p on p.id = parts.product_id
    where parts.provider_id = (select auth.uid())
      and p.provider_id = (select auth.uid())
      and p.listing_status <> 'archived'
  )
  and not exists (select 1 from private.attached_image_paths a where a.storage_path = object_name);
$$;

-- Deleting is allowed for the caller's own objects that are not attached to
-- a listing (orphans, or images already detached by remove_product_image).
create or replace function private.can_delete_product_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_provider()
    and split_part(object_name, '/', 1) = (select auth.uid())::text
    and not exists (select 1 from public.product_images i where i.storage_path = object_name);
$$;

revoke all on function private.photo_path_parts(text) from public, anon, authenticated;
revoke all on function private.can_upload_product_photo(text) from public, anon;
revoke all on function private.can_delete_product_photo(text) from public, anon;
grant execute on function private.can_upload_product_photo(text) to authenticated;
grant execute on function private.can_delete_product_photo(text) to authenticated;

-- No UPDATE policy: objects cannot be overwritten (no upsert), so verified
-- bytes cannot be swapped after attachment.
create policy "product-photos: providers upload to own listing folders"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-photos' and (select private.can_upload_product_photo(name)));

create policy "product-photos: owners list own objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'product-photos' and split_part(name, '/', 1) = (select auth.uid())::text);

create policy "product-photos: owners delete own unattached objects"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-photos' and (select private.can_delete_product_photo(name)));

-- ---------------------------------------------------------------------------
-- Image metadata functions
-- ---------------------------------------------------------------------------
create or replace function private.image_attestation_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  key text;
begin
  select decrypted_secret into key
  from vault.decrypted_secrets
  where name = 'borrownest_image_attestation'
  limit 1;
  if key is null or char_length(key) < 32 then
    raise exception 'BN:attestation_not_configured' using errcode = 'P0001';
  end if;
  return key;
end;
$$;
revoke all on function private.image_attestation_key() from public, anon, authenticated;

create or replace function public.attach_product_image(
  p_product_id uuid,
  p_storage_path text,
  p_caption text,
  p_signature text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  product public.products := private.lock_own_product(p_product_id);
  caller uuid := auth.uid();
  v_caption text := nullif(private.clean_line(p_caption), '');
  expected text;
  image_count integer;
  new_id uuid;
begin
  if product.listing_status = 'archived' then
    raise exception 'BN:listing_archived' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from private.photo_path_parts(p_storage_path) parts
    where parts.provider_id = caller and parts.product_id = product.id
  ) then
    raise exception 'BN:invalid_image_path' using errcode = 'P0001';
  end if;

  expected := pg_catalog.encode(extensions.hmac(
    'v1:' || caller::text || ':' || product.id::text || ':' || p_storage_path,
    private.image_attestation_key(), 'sha256'), 'hex');
  if p_signature is null or p_signature <> expected then
    raise exception 'BN:invalid_image_signature' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'product-photos' and o.name = p_storage_path
      and o.owner_id = caller::text
  ) then
    raise exception 'BN:image_not_uploaded' using errcode = 'P0001';
  end if;

  if v_caption is not null and char_length(v_caption) > 200 then
    raise exception 'BN:invalid_caption' using errcode = 'P0001';
  end if;

  -- The product row lock above serializes concurrent attachments.
  select count(*) into image_count from public.product_images where product_id = product.id;
  if image_count >= 5 then
    raise exception 'BN:image_limit' using errcode = 'P0001';
  end if;

  insert into private.attached_image_paths (storage_path, product_id)
  values (p_storage_path, product.id)
  on conflict (storage_path) do nothing;
  if not found then
    raise exception 'BN:image_already_used' using errcode = 'P0001';
  end if;

  insert into public.product_images (product_id, storage_path, sort_order, caption)
  values (product.id, p_storage_path, image_count, v_caption)
  returning id into new_id;

  perform private.mark_content_changed(product.id);
  return new_id;
end;
$$;

-- Rewrites sort_order to 0..n-1 in the given order (0 = cover). Two passes
-- keep the (product_id, sort_order) unique constraint satisfied throughout.
create or replace function private.apply_image_order(p_product_id uuid, p_image_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.product_images i
  set sort_order = 10 + o.position - 1
  from unnest(p_image_ids) with ordinality as o(image_id, position)
  where i.id = o.image_id and i.product_id = p_product_id;

  update public.product_images
  set sort_order = sort_order - 10
  where product_id = p_product_id;
end;
$$;
revoke all on function private.apply_image_order(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.reorder_product_images(p_product_id uuid, p_image_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  product public.products := private.lock_own_product(p_product_id);
  current_ids uuid[];
begin
  if product.listing_status = 'archived' then
    raise exception 'BN:listing_archived' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(id order by id), '{}') into current_ids
  from public.product_images where product_id = product.id;

  -- Must be exactly a permutation of the listing's current images.
  if p_image_ids is null
     or cardinality(p_image_ids) <> cardinality(current_ids)
     or (select array_agg(distinct x order by x) from unnest(p_image_ids) x) is distinct from current_ids then
    raise exception 'BN:invalid_image_order' using errcode = 'P0001';
  end if;

  perform private.apply_image_order(product.id, p_image_ids);
  perform private.mark_content_changed(product.id);
end;
$$;

-- Detaches an image and returns its storage path so the app can delete the
-- object (the delete policy only allows unattached objects).
create or replace function public.remove_product_image(p_image_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_product uuid;
  product public.products;
  removed_path text;
  remaining uuid[];
begin
  -- Another provider's image and a missing one fail identically.
  select i.product_id into target_product
  from public.product_images i
  join public.products p on p.id = i.product_id
  where i.id = p_image_id and p.provider_id = (select auth.uid());
  if target_product is null then
    raise exception 'BN:image_not_found' using errcode = 'P0001';
  end if;

  product := private.lock_own_product(target_product); -- also checks ownership
  if product.listing_status = 'archived' then
    raise exception 'BN:listing_archived' using errcode = 'P0001';
  end if;

  delete from public.product_images
  where id = p_image_id and product_id = product.id
  returning storage_path into removed_path;
  if removed_path is null then
    raise exception 'BN:image_not_found' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(id order by sort_order), '{}') into remaining
  from public.product_images where product_id = product.id;
  perform private.apply_image_order(product.id, remaining);

  perform private.mark_content_changed(product.id);
  return removed_path;
end;
$$;

revoke all on function public.attach_product_image(uuid, text, text, text) from public, anon;
revoke all on function public.reorder_product_images(uuid, uuid[]) from public, anon;
revoke all on function public.remove_product_image(uuid) from public, anon;
grant execute on function public.attach_product_image(uuid, text, text, text) to authenticated;
grant execute on function public.reorder_product_images(uuid, uuid[]) to authenticated;
grant execute on function public.remove_product_image(uuid) to authenticated;
