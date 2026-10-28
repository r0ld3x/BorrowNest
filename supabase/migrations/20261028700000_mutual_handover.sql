-- BorrowNest Stage 8: mutual handover and offline payment acknowledgement.
--
-- A confirmed booking becomes active only when its renter AND provider each
-- confirm the same immutable revision of the handover summary (item
-- condition, the physical exchange, and the rent and deposit paid offline).
-- The platform records both people's acknowledgements; it does not verify
-- any bank or UPI transfer. Lock order everywhere: booking, then exchange.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.booking_exchanges (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  kind text not null constraint booking_exchanges_kind check (kind in ('handover', 'return')),
  revision integer not null constraint booking_exchanges_revision_positive check (revision >= 1),
  created_by uuid not null,
  -- Copied from the booking; validated by trigger, never supplied by users.
  rent_amount numeric(12, 2) not null,
  deposit_amount numeric(12, 2) not null,
  payment_method text not null constraint booking_exchanges_payment_method check (payment_method in ('cash', 'upi', 'bank_transfer')),
  condition_notes text not null constraint booking_exchanges_condition_length check (char_length(condition_notes) between 3 and 1000),
  change_reason text constraint booking_exchanges_reason_length check (char_length(change_reason) <= 500),
  scheduled_at timestamptz not null,
  status text not null default 'current' constraint booking_exchanges_status check (status in ('current', 'superseded')),
  superseded_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint booking_exchanges_revision_unique unique (booking_id, kind, revision)
);
create unique index booking_exchanges_one_current on public.booking_exchanges (booking_id, kind) where status = 'current';

create table public.exchange_confirmations (
  id uuid primary key default gen_random_uuid(),
  exchange_id uuid not null references public.booking_exchanges (id) on delete restrict,
  participant_id uuid not null,
  participant_role text not null constraint exchange_confirmations_role check (participant_role in ('renter', 'provider')),
  acknowledged text[] not null,
  confirmed_at timestamptz not null default pg_catalog.now(),
  constraint exchange_confirmations_once unique (exchange_id, participant_id)
);

create table public.exchange_evidence (
  id uuid primary key default gen_random_uuid(),
  exchange_id uuid not null references public.booking_exchanges (id) on delete restrict,
  storage_path text not null constraint exchange_evidence_path_length check (char_length(storage_path) between 1 and 512),
  caption text constraint exchange_evidence_caption_length check (char_length(caption) <= 200),
  uploaded_by uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint exchange_evidence_unique unique (exchange_id, storage_path)
);

-- Private issue flag that holds the booking. Stage 10 expands this into
-- full disputes; for now an open issue blocks activation.
create table public.booking_issues (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  opened_by uuid not null,
  opened_by_role text not null constraint booking_issues_role check (opened_by_role in ('renter', 'provider')),
  category text not null constraint booking_issues_category check (category in ('condition', 'payment', 'handover', 'other')),
  description text not null constraint booking_issues_description_length check (char_length(description) between 10 and 1000),
  status text not null default 'open' constraint booking_issues_status check (status in ('open', 'resolved')),
  resolution text constraint booking_issues_resolution_length check (char_length(resolution) <= 500),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default pg_catalog.now()
);
create index booking_issues_open_idx on public.booking_issues (booking_id) where status = 'open';

create table private.attached_evidence_paths (
  storage_path text primary key,
  attached_at timestamptz not null default pg_catalog.now()
);
revoke all on table private.attached_evidence_paths from public, anon, authenticated;

-- Event and audit vocabulary.
alter table public.booking_events drop constraint booking_events_type_allowed;
alter table public.booking_events add constraint booking_events_type_allowed check (event_type in (
  'request_created', 'request_confirmed', 'request_rejected', 'request_cancelled', 'admin_cancelled',
  'handover_prepared', 'handover_revised', 'handover_confirmed', 'rental_activated', 'issue_reported', 'issue_resolved'
));
alter table public.admin_audit_logs drop constraint admin_audit_action_allowed;
alter table public.admin_audit_logs add constraint admin_audit_action_allowed check (action in (
  'listing.approve', 'listing.reject', 'listing.edit', 'account.suspend', 'account.restore', 'booking.cancel', 'booking.issue_resolve'
));

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------
-- Exchange amounts must equal the booking's own snapshot.
create or replace function private.check_exchange_amounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = new.booking_id;
  if new.rent_amount <> b.rental_amount or new.deposit_amount <> b.deposit then
    raise exception 'BN:amount_mismatch' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.check_exchange_amounts() from public, anon, authenticated;
create trigger booking_exchanges_check_amounts before insert on public.booking_exchanges
  for each row execute function private.check_exchange_amounts();

-- Revisions are immutable apart from being superseded once.
create or replace function private.protect_exchange_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.booking_id, new.kind, new.revision, new.created_by, new.rent_amount, new.deposit_amount,
      new.payment_method, new.condition_notes, new.change_reason, new.scheduled_at, new.created_at)
     is distinct from
     (old.booking_id, old.kind, old.revision, old.created_by, old.rent_amount, old.deposit_amount,
      old.payment_method, old.condition_notes, old.change_reason, old.scheduled_at, old.created_at)
     or (old.status = 'superseded') then
    raise exception 'BN:exchange_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_exchange_revision() from public, anon, authenticated;
create trigger booking_exchanges_protect before update on public.booking_exchanges
  for each row execute function private.protect_exchange_revision();

-- A booking can only become active after both participants confirmed the
-- current handover revision: even trusted code cannot skip this.
create or replace function private.check_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phase = 'active' and old.phase is distinct from 'active' then
    if old.status <> 'confirmed' or old.phase <> 'awaiting_handover' or not exists (
      select 1 from public.booking_exchanges x
      where x.booking_id = new.id and x.kind = 'handover' and x.status = 'current'
        and (select count(distinct c.participant_role) from public.exchange_confirmations c where c.exchange_id = x.id) = 2
    ) then
      raise exception 'BN:activation_requires_both_confirmations' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.check_activation() from public, anon, authenticated;
create trigger bookings_check_activation before update on public.bookings
  for each row execute function private.check_activation();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Locks the booking and returns it with the caller's role in it, or fails
-- identically for non-participants. Active account required.
create or replace function private.lock_booking_as_participant(p_booking_id uuid, out booking public.bookings, out caller_role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  select * into booking from public.bookings where id = p_booking_id for update;
  if not found or caller is null or (booking.renter_id <> caller and booking.provider_id <> caller) then
    raise exception 'BN:booking_not_found' using errcode = 'P0001';
  end if;
  caller_role := case when booking.renter_id = caller then 'renter' else 'provider' end;
  if not private.has_active_role(caller_role::public.user_role) then
    raise exception 'BN:account_not_active' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.lock_booking_as_participant(uuid) from public, anon, authenticated;

create or replace function private.assert_handover_open(booking public.bookings)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if booking.status <> 'confirmed' or booking.phase <> 'awaiting_handover' then
    raise exception 'BN:handover_not_open' using errcode = 'P0001';
  end if;
  -- Past the scheduled return, an exchange needs admin resolution instead.
  if pg_catalog.now() >= booking.return_at then
    raise exception 'BN:handover_expired' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.assert_handover_open(public.bookings) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Handover workflow
-- ---------------------------------------------------------------------------
create or replace function public.prepare_handover(p_booking_id uuid, p_condition_notes text, p_payment_method text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  v_notes text := private.clean_block(p_condition_notes);
  new_id uuid;
begin
  select * into locked from private.lock_booking_as_participant(p_booking_id);
  if locked.caller_role <> 'provider' then
    raise exception 'BN:provider_prepares_handover' using errcode = 'P0001';
  end if;
  perform private.assert_handover_open(locked.booking);
  if exists (select 1 from public.booking_exchanges where booking_id = p_booking_id and kind = 'handover') then
    raise exception 'BN:handover_exists' using errcode = 'P0001';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'upi', 'bank_transfer') then
    raise exception 'BN:invalid_payment_method' using errcode = 'P0001';
  end if;
  if char_length(v_notes) not between 3 and 1000 then
    raise exception 'BN:invalid_condition_notes' using errcode = 'P0001';
  end if;

  insert into public.booking_exchanges (booking_id, kind, revision, created_by, rent_amount, deposit_amount,
                                        payment_method, condition_notes, scheduled_at)
  values (p_booking_id, 'handover', 1, auth.uid(), (locked.booking).rental_amount, (locked.booking).deposit,
          p_payment_method, v_notes, (locked.booking).pickup_at)
  returning id into new_id;

  insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status)
  values (p_booking_id, auth.uid(), 'handover_prepared', 'confirmed', 'confirmed');
  return new_id;
end;
$$;

-- Either participant may correct the summary. The new revision supersedes
-- the old one, so confirmations of the old revision stop counting. Dates
-- and amounts cannot be changed this way.
create or replace function public.revise_handover(
  p_exchange_id uuid, p_expected_revision integer, p_condition_notes text, p_payment_method text, p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  locked record;
  current_x public.booking_exchanges;
  v_notes text := private.clean_block(p_condition_notes);
  v_reason text := private.require_reason(p_reason, 5);
  new_id uuid;
begin
  select x.booking_id into v_booking_id from public.booking_exchanges x where x.id = p_exchange_id;
  if v_booking_id is null then
    raise exception 'BN:booking_not_found' using errcode = 'P0001';
  end if;
  select * into locked from private.lock_booking_as_participant(v_booking_id);
  perform private.assert_handover_open(locked.booking);

  select * into current_x from public.booking_exchanges
  where booking_id = v_booking_id and kind = 'handover' and status = 'current' for update;
  if current_x.id is distinct from p_exchange_id or current_x.revision is distinct from p_expected_revision then
    raise exception 'BN:stale_revision' using errcode = 'P0001';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'upi', 'bank_transfer') then
    raise exception 'BN:invalid_payment_method' using errcode = 'P0001';
  end if;
  if char_length(v_notes) not between 3 and 1000 then
    raise exception 'BN:invalid_condition_notes' using errcode = 'P0001';
  end if;
  if v_notes = current_x.condition_notes and p_payment_method = current_x.payment_method then
    raise exception 'BN:no_change' using errcode = 'P0001';
  end if;

  update public.booking_exchanges set status = 'superseded', superseded_at = pg_catalog.now() where id = current_x.id;
  insert into public.booking_exchanges (booking_id, kind, revision, created_by, rent_amount, deposit_amount,
                                        payment_method, condition_notes, change_reason, scheduled_at)
  values (v_booking_id, 'handover', current_x.revision + 1, auth.uid(), current_x.rent_amount, current_x.deposit_amount,
          p_payment_method, v_notes, v_reason, current_x.scheduled_at)
  returning id into new_id;
  -- Evidence stays visible on the new revision; the old revision keeps its own copy.
  insert into public.exchange_evidence (exchange_id, storage_path, caption, uploaded_by, created_at)
  select new_id, e.storage_path, e.caption, e.uploaded_by, e.created_at from public.exchange_evidence e where e.exchange_id = current_x.id;

  insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status, reason)
  values (v_booking_id, auth.uid(), 'handover_revised', 'confirmed', 'confirmed', v_reason);
  return new_id;
end;
$$;

create or replace function public.confirm_handover(p_exchange_id uuid, p_revision integer, p_acknowledgements text[])
returns public.rental_phase
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  locked record;
  x public.booking_exchanges;
  required text[];
  inserted boolean;
  confirmed_roles integer;
begin
  select e.booking_id into v_booking_id from public.booking_exchanges e where e.id = p_exchange_id and e.kind = 'handover';
  if v_booking_id is null then
    raise exception 'BN:booking_not_found' using errcode = 'P0001';
  end if;
  -- Lock order: booking, then exchange.
  select * into locked from private.lock_booking_as_participant(v_booking_id);
  select * into x from public.booking_exchanges where id = p_exchange_id for update;

  -- Repeat after activation: harmless no-op.
  if (locked.booking).phase = 'active'
     and exists (select 1 from public.exchange_confirmations c where c.exchange_id = x.id and c.participant_id = auth.uid()) then
    return 'active';
  end if;

  perform private.assert_handover_open(locked.booking);
  if x.status <> 'current' or x.revision <> p_revision then
    raise exception 'BN:stale_revision' using errcode = 'P0001';
  end if;
  if x.rent_amount <> (locked.booking).rental_amount or x.deposit_amount <> (locked.booking).deposit then
    raise exception 'BN:amount_mismatch' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.booking_issues i where i.booking_id = v_booking_id and i.status = 'open') then
    raise exception 'BN:issue_open' using errcode = 'P0001';
  end if;

  required := case locked.caller_role
    when 'renter' then array['received_item', 'condition_agreed', 'paid_amounts']
    else array['handed_over_item', 'condition_matches', 'received_amounts'] end;
  if p_acknowledgements is null or not (p_acknowledgements @> required and required @> p_acknowledgements) then
    raise exception 'BN:acknowledgements_required' using errcode = 'P0001';
  end if;

  insert into public.exchange_confirmations (exchange_id, participant_id, participant_role, acknowledged)
  values (x.id, auth.uid(), locked.caller_role, required)
  on conflict (exchange_id, participant_id) do nothing;
  inserted := found;

  if inserted then
    insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status, reason)
    values (v_booking_id, auth.uid(), 'handover_confirmed', 'confirmed', 'confirmed', locked.caller_role || ' confirmed revision ' || x.revision);
  end if;

  select count(distinct participant_role) into confirmed_roles from public.exchange_confirmations where exchange_id = x.id;
  if confirmed_roles = 2 then
    update public.bookings set phase = 'active' where id = v_booking_id;
    insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status)
    values (v_booking_id, auth.uid(), 'rental_activated', 'confirmed', 'confirmed');
    return 'active';
  end if;
  return 'awaiting_handover';
end;
$$;

-- ---------------------------------------------------------------------------
-- Issue hold
-- ---------------------------------------------------------------------------
create or replace function public.report_booking_issue(p_booking_id uuid, p_category text, p_description text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  v_description text := private.clean_block(p_description);
  new_id uuid;
begin
  select * into locked from private.lock_booking_as_participant(p_booking_id);
  if (locked.booking).status <> 'confirmed' then
    raise exception 'BN:booking_not_active' using errcode = 'P0001';
  end if;
  if p_category is null or p_category not in ('condition', 'payment', 'handover', 'other') then
    raise exception 'BN:invalid_category' using errcode = 'P0001';
  end if;
  if char_length(v_description) not between 10 and 1000 then
    raise exception 'BN:invalid_description' using errcode = 'P0001';
  end if;
  if (select count(*) from public.booking_issues where booking_id = p_booking_id and status = 'open') >= 5 then
    raise exception 'BN:too_many_issues' using errcode = 'P0001';
  end if;

  insert into public.booking_issues (booking_id, opened_by, opened_by_role, category, description)
  values (p_booking_id, auth.uid(), locked.caller_role, p_category, v_description)
  returning id into new_id;
  insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status, reason)
  values (p_booking_id, auth.uid(), 'issue_reported', 'confirmed', 'confirmed', locked.caller_role || ' reported a ' || p_category || ' issue');
  return new_id;
end;
$$;

create or replace function public.admin_resolve_booking_issue(p_issue_id uuid, p_resolution text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_active_admin();
  issue public.booking_issues;
  v_resolution text := private.require_reason(p_resolution, 10);
begin
  select * into issue from public.booking_issues where id = p_issue_id;
  if not found then
    raise exception 'BN:issue_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.bookings where id = issue.booking_id for update;
  select * into issue from public.booking_issues where id = p_issue_id for update;
  if issue.status = 'resolved' then
    return 'resolved';
  end if;
  update public.booking_issues
  set status = 'resolved', resolution = v_resolution, resolved_by = caller, resolved_at = pg_catalog.now()
  where id = issue.id;
  insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status, reason)
  values (issue.booking_id, caller, 'issue_resolved', 'confirmed', 'confirmed', 'Resolved by BorrowNest support: ' || v_resolution);
  perform private.write_audit(caller, 'booking.issue_resolve', 'booking', issue.booking_id, v_resolution,
    jsonb_build_object('issue_id', issue.id, 'category', issue.category, 'opened_by_role', issue.opened_by_role));
  return 'resolved';
end;
$$;

create or replace function public.admin_open_issues(p_limit integer, p_offset integer)
returns table (
  id uuid, booking_id uuid, product_title text, opened_by_role text, category text, description text,
  created_at timestamptz, total_count bigint
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
  select i.id, i.booking_id, p.title, i.opened_by_role, i.category, i.description, i.created_at, count(*) over ()
  from public.booking_issues i
  join public.bookings b on b.id = i.booking_id
  join public.products p on p.id = b.product_id
  where i.status = 'open'
  order by i.created_at, i.id
  limit page_size offset page_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- Private evidence storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exchange-evidence', 'exchange-evidence', false, 5242880, array['image/webp'])
on conflict (id) do nothing;

-- Object names: <booking uuid>/<exchange uuid>/<random uuid>.webp
create or replace function private.evidence_path_parts(object_name text)
returns table (booking_id uuid, exchange_id uuid)
language sql
immutable
set search_path = ''
as $$
  select split_part(object_name, '/', 1)::uuid, split_part(object_name, '/', 2)::uuid
  where object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$';
$$;
revoke all on function private.evidence_path_parts(text) from public, anon, authenticated;

-- Caller is an active participant of the booking that owns the exchange.
create or replace function private.is_exchange_participant(p_booking_id uuid, p_exchange_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    join public.booking_exchanges x on x.booking_id = b.id and x.id = p_exchange_id
    where b.id = p_booking_id
      and ((b.renter_id = (select auth.uid()) and private.has_active_role('renter'::public.user_role))
        or (b.provider_id = (select auth.uid()) and private.is_active_provider()))
  );
$$;
revoke all on function private.is_exchange_participant(uuid, uuid) from public, anon;
grant execute on function private.is_exchange_participant(uuid, uuid) to authenticated;

create or replace function private.can_upload_evidence(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.evidence_path_parts(object_name) parts
    join public.booking_exchanges x on x.id = parts.exchange_id and x.booking_id = parts.booking_id and x.status = 'current'
    join public.bookings b on b.id = parts.booking_id and b.status = 'confirmed' and b.phase = 'awaiting_handover'
    where private.is_exchange_participant(parts.booking_id, parts.exchange_id)
  )
  and not exists (select 1 from private.attached_evidence_paths a where a.storage_path = object_name);
$$;

create or replace function private.can_read_evidence(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_admin() or exists (
    select 1 from private.evidence_path_parts(object_name) parts
    where private.is_exchange_participant(parts.booking_id, parts.exchange_id)
  );
$$;
revoke all on function private.can_upload_evidence(text) from public, anon;
revoke all on function private.can_read_evidence(text) from public, anon;
grant execute on function private.can_upload_evidence(text) to authenticated;
grant execute on function private.can_read_evidence(text) to authenticated;

-- No update or delete policies: evidence cannot be replaced or removed.
create policy "exchange-evidence: participants upload to current handover"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'exchange-evidence' and (select private.can_upload_evidence(name)));
create policy "exchange-evidence: participants and admins read"
  on storage.objects for select to authenticated
  using (bucket_id = 'exchange-evidence' and (select private.can_read_evidence(name)));

create or replace function public.attach_exchange_evidence(
  p_exchange_id uuid, p_storage_path text, p_caption text, p_signature text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  locked record;
  x public.booking_exchanges;
  v_caption text := nullif(private.clean_line(p_caption), '');
  expected text;
  new_id uuid;
begin
  select e.booking_id into v_booking_id from public.booking_exchanges e where e.id = p_exchange_id;
  if v_booking_id is null then
    raise exception 'BN:booking_not_found' using errcode = 'P0001';
  end if;
  select * into locked from private.lock_booking_as_participant(v_booking_id);
  select * into x from public.booking_exchanges where id = p_exchange_id for update;
  perform private.assert_handover_open(locked.booking);
  if x.status <> 'current' then
    raise exception 'BN:stale_revision' using errcode = 'P0001';
  end if;
  if not exists (select 1 from private.evidence_path_parts(p_storage_path) parts
                 where parts.booking_id = v_booking_id and parts.exchange_id = x.id) then
    raise exception 'BN:invalid_evidence_path' using errcode = 'P0001';
  end if;
  expected := pg_catalog.encode(extensions.hmac(
    'evidence:v1:' || auth.uid()::text || ':' || x.id::text || ':' || p_storage_path,
    private.image_attestation_key(), 'sha256'), 'hex');
  if p_signature is null or p_signature <> expected then
    raise exception 'BN:invalid_image_signature' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'exchange-evidence' and o.name = p_storage_path and o.owner_id = auth.uid()::text) then
    raise exception 'BN:image_not_uploaded' using errcode = 'P0001';
  end if;
  if v_caption is not null and char_length(v_caption) > 200 then
    raise exception 'BN:invalid_caption' using errcode = 'P0001';
  end if;
  if (select count(*) from public.exchange_evidence where exchange_id = x.id) >= 6 then
    raise exception 'BN:evidence_limit' using errcode = 'P0001';
  end if;
  insert into private.attached_evidence_paths (storage_path) values (p_storage_path) on conflict do nothing;
  if not found then
    raise exception 'BN:image_already_used' using errcode = 'P0001';
  end if;
  insert into public.exchange_evidence (exchange_id, storage_path, caption, uploaded_by)
  values (x.id, p_storage_path, v_caption, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read access (participants of a visible booking; admins)
-- ---------------------------------------------------------------------------
alter table public.booking_exchanges enable row level security;
alter table public.exchange_confirmations enable row level security;
alter table public.exchange_evidence enable row level security;
alter table public.booking_issues enable row level security;

revoke all on table public.booking_exchanges from public, anon, authenticated;
revoke all on table public.exchange_confirmations from public, anon, authenticated;
revoke all on table public.exchange_evidence from public, anon, authenticated;
revoke all on table public.booking_issues from public, anon, authenticated;
grant select on table public.booking_exchanges, public.exchange_confirmations, public.exchange_evidence, public.booking_issues to authenticated;
grant select, insert, update, delete on table public.booking_exchanges, public.exchange_confirmations, public.exchange_evidence, public.booking_issues to service_role;

-- The bookings subquery is itself RLS-filtered (own renter / own provider / admin).
create policy "booking_exchanges: with their booking" on public.booking_exchanges for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_exchanges.booking_id));
create policy "exchange_confirmations: with their exchange" on public.exchange_confirmations for select to authenticated
  using (exists (select 1 from public.booking_exchanges x where x.id = exchange_confirmations.exchange_id));
create policy "exchange_evidence: with their exchange" on public.exchange_evidence for select to authenticated
  using (exists (select 1 from public.booking_exchanges x where x.id = exchange_evidence.exchange_id));
create policy "booking_issues: with their booking" on public.booking_issues for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_issues.booking_id));

revoke all on function public.prepare_handover(uuid, text, text) from public, anon;
revoke all on function public.revise_handover(uuid, integer, text, text, text) from public, anon;
revoke all on function public.confirm_handover(uuid, integer, text[]) from public, anon;
revoke all on function public.report_booking_issue(uuid, text, text) from public, anon;
revoke all on function public.admin_resolve_booking_issue(uuid, text) from public, anon;
revoke all on function public.admin_open_issues(integer, integer) from public, anon;
revoke all on function public.attach_exchange_evidence(uuid, text, text, text) from public, anon;
grant execute on function public.prepare_handover(uuid, text, text) to authenticated;
grant execute on function public.revise_handover(uuid, integer, text, text, text) to authenticated;
grant execute on function public.confirm_handover(uuid, integer, text[]) to authenticated;
grant execute on function public.report_booking_issue(uuid, text, text) to authenticated;
grant execute on function public.admin_resolve_booking_issue(uuid, text) to authenticated;
grant execute on function public.admin_open_issues(integer, integer) to authenticated;
grant execute on function public.attach_exchange_evidence(uuid, text, text, text) to authenticated;
