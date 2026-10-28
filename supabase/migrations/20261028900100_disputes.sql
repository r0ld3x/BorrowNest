-- BorrowNest Stage 10: disputes and administrative resolution.
--
-- Stage 8 issue flags become disputes in place (same rows, ids and events),
-- so existing holds and history carry over. A dispute that is not resolved
-- holds the booking: activation and completion refuse under the booking
-- lock, and the phase trigger refuses even for direct writes. Admins review,
-- ask for information in-app and record a reasoned resolution; an
-- administrative closure is a separate outcome from mutual completion and
-- records possession and money still owed, never "paid".
--
-- Post-completion window: a participant may open a support case for 14
-- days after mutual completion. It never reopens or rewrites the completed
-- booking. Lock order everywhere: booking, then dispute.

-- ---------------------------------------------------------------------------
-- Booking status: closed (administrative closure)
-- ---------------------------------------------------------------------------
alter table public.bookings drop constraint bookings_phase_matches_status;
alter table public.bookings add constraint bookings_phase_matches_status check (
  (status in ('pending', 'rejected', 'cancelled') and phase = 'awaiting_handover')
  or status in ('confirmed', 'closed')
  or (status = 'completed' and phase = 'returned')
);

-- Closed bookings keep their dates: possession or money may be unresolved.
alter table public.bookings drop constraint no_overlapping_reserved_bookings;
alter table public.bookings
  add constraint no_overlapping_reserved_bookings
  exclude using gist (
    product_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
  where (status in ('confirmed', 'completed', 'closed'));

-- ---------------------------------------------------------------------------
-- Disputes (migrated from booking_issues)
-- ---------------------------------------------------------------------------
alter table public.booking_issues rename to booking_disputes;
drop index public.booking_issues_open_idx;
alter table public.booking_disputes drop constraint booking_issues_status;
alter table public.booking_disputes drop constraint booking_issues_category;
alter table public.booking_disputes drop constraint booking_issues_role;
alter table public.booking_disputes
  add column on_behalf_of text constraint booking_disputes_on_behalf check (on_behalf_of in ('renter', 'provider')),
  add column phase_at_open public.rental_phase,
  add column post_completion boolean not null default false,
  add column updated_at timestamptz not null default pg_catalog.now();
alter table public.booking_disputes
  add constraint booking_disputes_status check (status in ('open', 'in_review', 'needs_info', 'resolved')),
  add constraint booking_disputes_category check (category in ('handover', 'payment', 'condition', 'return', 'refund', 'other')),
  add constraint booking_disputes_role check (opened_by_role in ('renter', 'provider', 'admin')),
  add constraint booking_disputes_admin_on_behalf check ((opened_by_role = 'admin') = (on_behalf_of is not null)),
  add constraint booking_disputes_resolved_fields check ((status = 'resolved') = (resolved_by is not null and resolved_at is not null));
alter index public.booking_issues_pkey rename to booking_disputes_pkey;
create index booking_disputes_active_idx on public.booking_disputes (booking_id) where status <> 'resolved';
create index booking_disputes_queue_idx on public.booking_disputes (status, created_at);
update public.booking_disputes d
set phase_at_open = b.phase
from public.bookings b
where b.id = d.booking_id and d.phase_at_open is null;

create table public.dispute_resolutions (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.booking_disputes (id) on delete restrict,
  admin_id uuid not null,
  decision text not null constraint dispute_resolutions_decision check (
    decision in ('no_action', 'renter_favoured', 'provider_favoured', 'shared', 'admin_closure')),
  reason text not null constraint dispute_resolutions_reason_length check (char_length(reason) between 10 and 1000),
  acknowledged_facts text constraint dispute_resolutions_facts_length check (char_length(acknowledged_facts) <= 2000),
  -- Money still owed after the decision. Recording it does not mean it was paid.
  provider_owes_renter numeric(12, 2) not null default 0
    constraint dispute_resolutions_provider_owes check (provider_owes_renter between 0 and 1000000),
  renter_owes_provider numeric(12, 2) not null default 0
    constraint dispute_resolutions_renter_owes check (renter_owes_provider between 0 and 1000000),
  obligation_note text constraint dispute_resolutions_obligation_length check (char_length(obligation_note) <= 500),
  possession_outcome text not null constraint dispute_resolutions_possession check (
    possession_outcome in ('not_applicable', 'with_renter', 'returned_to_provider', 'lost', 'damaged')),
  created_at timestamptz not null default pg_catalog.now(),
  constraint dispute_resolutions_one_per_dispute unique (dispute_id)
);

-- Keep the Stage 8 resolutions as history.
insert into public.dispute_resolutions (dispute_id, admin_id, decision, reason, possession_outcome, created_at)
select id, resolved_by, 'no_action', resolution, 'not_applicable', resolved_at
from public.booking_disputes
where status = 'resolved' and resolution is not null;
alter table public.booking_disputes drop column resolution;

create table public.dispute_messages (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.booking_disputes (id) on delete restrict,
  author_id uuid not null,
  author_role text not null constraint dispute_messages_role check (author_role in ('renter', 'provider', 'admin')),
  kind text not null constraint dispute_messages_kind check (kind in ('statement', 'info_request', 'status_note')),
  body text not null constraint dispute_messages_body_length check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default pg_catalog.now()
);
create index dispute_messages_dispute_idx on public.dispute_messages (dispute_id, created_at);

create table public.dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.booking_disputes (id) on delete restrict,
  storage_path text not null constraint dispute_evidence_path_length check (char_length(storage_path) between 1 and 512),
  caption text constraint dispute_evidence_caption_length check (char_length(caption) <= 200),
  uploaded_by uuid not null,
  uploader_role text not null constraint dispute_evidence_role check (uploader_role in ('renter', 'provider')),
  created_at timestamptz not null default pg_catalog.now(),
  constraint dispute_evidence_unique unique (storage_path)
);

create table public.admin_closures (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  resolution_id uuid not null references public.dispute_resolutions (id) on delete restrict,
  admin_id uuid not null,
  possession_outcome text not null constraint admin_closures_possession check (possession_outcome in ('returned_to_provider', 'lost', 'damaged')),
  provider_owes_renter_outstanding numeric(12, 2) not null constraint admin_closures_provider_owes check (provider_owes_renter_outstanding >= 0),
  renter_owes_provider_outstanding numeric(12, 2) not null constraint admin_closures_renter_owes check (renter_owes_provider_outstanding >= 0),
  reason text not null constraint admin_closures_reason_length check (char_length(reason) between 10 and 1000),
  created_at timestamptz not null default pg_catalog.now(),
  constraint admin_closures_one_per_booking unique (booking_id)
);

-- Missing or damaged inventory stays unavailable until an admin releases it.
alter table public.products
  add column inventory_hold text constraint products_inventory_hold check (inventory_hold in ('lost', 'damaged'));

create or replace function private.check_inventory_hold()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.inventory_hold is not null and new.listing_status = 'published' then
    raise exception 'BN:inventory_hold' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.check_inventory_hold() from public, anon, authenticated;
create trigger products_check_inventory_hold before update on public.products
  for each row execute function private.check_inventory_hold();

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------
create or replace function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'BN:record_immutable' using errcode = 'P0001';
end;
$$;
revoke all on function private.forbid_change() from public, anon, authenticated;
create trigger dispute_messages_immutable before update or delete on public.dispute_messages
  for each row execute function private.forbid_change();
create trigger dispute_resolutions_immutable before update or delete on public.dispute_resolutions
  for each row execute function private.forbid_change();
create trigger dispute_evidence_immutable before update or delete on public.dispute_evidence
  for each row execute function private.forbid_change();
create trigger admin_closures_immutable before update or delete on public.admin_closures
  for each row execute function private.forbid_change();

-- A dispute's opening statement and authorship never change; it moves
-- forward through statuses only, and a resolved dispute stays resolved.
create or replace function private.protect_dispute()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.booking_id, new.opened_by, new.opened_by_role, new.on_behalf_of, new.category, new.description,
      new.phase_at_open, new.post_completion, new.created_at)
     is distinct from
     (old.booking_id, old.opened_by, old.opened_by_role, old.on_behalf_of, old.category, old.description,
      old.phase_at_open, old.post_completion, old.created_at)
     or old.status = 'resolved' then
    raise exception 'BN:record_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_dispute() from public, anon, authenticated;
create trigger booking_disputes_protect before update on public.booking_disputes
  for each row execute function private.protect_dispute();

-- ---------------------------------------------------------------------------
-- Holds
-- ---------------------------------------------------------------------------
-- Derived only from unresolved disputes; there is no editable hold flag.
create or replace function private.has_active_hold(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.booking_disputes d
    where d.booking_id = p_booking_id and d.status <> 'resolved' and not d.post_completion
  );
$$;
revoke all on function private.has_active_hold(uuid) from public, anon, authenticated;

create or replace function private.check_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phase is not distinct from old.phase then
    return new;
  end if;
  if old.status <> 'confirmed' then
    raise exception 'BN:invalid_phase_transition' using errcode = 'P0001';
  end if;

  if old.phase = 'awaiting_handover' and new.phase = 'active' then
    if private.has_active_hold(new.id) then
      raise exception 'BN:issue_open' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.booking_exchanges x
      where x.booking_id = new.id and x.kind = 'handover' and x.status = 'current'
        and (select count(distinct c.participant_role) from public.exchange_confirmations c where c.exchange_id = x.id) = 2
    ) then
      raise exception 'BN:activation_requires_both_confirmations' using errcode = 'P0001';
    end if;
  elsif old.phase = 'active' and new.phase = 'return_requested' then
    if not exists (select 1 from public.return_proposals p where p.booking_id = new.id and p.status = 'accepted') then
      raise exception 'BN:return_requires_accepted_proposal' using errcode = 'P0001';
    end if;
  elsif old.phase = 'return_requested' and new.phase = 'active' then
    if exists (select 1 from public.booking_exchanges x where x.booking_id = new.id and x.kind = 'return') then
      raise exception 'BN:return_in_progress' using errcode = 'P0001';
    end if;
  elsif old.phase = 'return_requested' and new.phase = 'returned' then
    if private.has_active_hold(new.id) then
      raise exception 'BN:issue_open' using errcode = 'P0001';
    end if;
    if new.status <> 'completed' or not exists (
      select 1 from public.booking_exchanges x
      where x.booking_id = new.id and x.kind = 'return' and x.status = 'current'
        and (select count(distinct c.participant_role) from public.exchange_confirmations c where c.exchange_id = x.id) = 2
    ) then
      raise exception 'BN:completion_requires_both_confirmations' using errcode = 'P0001';
    end if;
  else
    raise exception 'BN:invalid_phase_transition' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Final statuses stay final; completion and closure each need their record.
create or replace function private.check_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('completed', 'closed', 'rejected', 'cancelled') and new.status is distinct from old.status then
    raise exception 'BN:booking_final' using errcode = 'P0001';
  end if;
  if new.status = 'completed' and old.status <> 'completed' and not (old.phase = 'return_requested' and new.phase = 'returned') then
    raise exception 'BN:completion_requires_both_confirmations' using errcode = 'P0001';
  end if;
  if new.status = 'closed' and old.status <> 'closed'
     and not exists (select 1 from public.admin_closures c where c.booking_id = new.id) then
    raise exception 'BN:closure_requires_record' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------
alter table public.booking_events drop constraint booking_events_type_allowed;
alter table public.booking_events add constraint booking_events_type_allowed check (event_type in (
  'request_created', 'request_confirmed', 'request_rejected', 'request_cancelled', 'admin_cancelled',
  'handover_prepared', 'handover_revised', 'handover_confirmed', 'rental_activated', 'issue_reported', 'issue_resolved',
  'return_proposed', 'return_accepted', 'return_prepared', 'return_revised', 'return_confirmed', 'rental_completed',
  'dispute_opened', 'dispute_status_changed', 'dispute_resolved', 'admin_closed'
));
alter table public.admin_audit_logs drop constraint admin_audit_action_allowed;
alter table public.admin_audit_logs add constraint admin_audit_action_allowed check (action in (
  'listing.approve', 'listing.reject', 'listing.edit', 'account.suspend', 'account.restore', 'booking.cancel', 'booking.issue_resolve',
  'dispute.open_on_behalf', 'dispute.status', 'dispute.resolve', 'booking.admin_close', 'listing.inventory_hold', 'listing.inventory_release'
));

-- ---------------------------------------------------------------------------
-- Participant functions
-- ---------------------------------------------------------------------------
drop function public.report_booking_issue(uuid, text, text);
drop function public.admin_resolve_booking_issue(uuid, text);
drop function public.admin_open_issues(integer, integer);

-- When a booking may have a dispute opened, and whether it is a
-- post-completion support case (which never holds or rewrites anything).
create or replace function private.dispute_window(booking public.bookings)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  completed_at timestamptz;
begin
  if booking.status = 'confirmed' then
    return false;
  end if;
  if booking.status = 'completed' then
    select max(e.created_at) into completed_at from public.booking_events e
    where e.booking_id = booking.id and e.event_type = 'rental_completed';
    if completed_at is not null and pg_catalog.now() <= completed_at + interval '14 days' then
      return true;
    end if;
    raise exception 'BN:dispute_window_closed' using errcode = 'P0001';
  end if;
  raise exception 'BN:booking_not_disputable' using errcode = 'P0001';
end;
$$;
revoke all on function private.dispute_window(public.bookings) from public, anon, authenticated;

create or replace function private.insert_dispute(
  booking public.bookings, p_actor uuid, p_role text, p_on_behalf text, p_category text, p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  post boolean := private.dispute_window(booking);
  v_description text := private.clean_block(p_description);
  new_id uuid;
begin
  if p_category is null or p_category not in ('handover', 'payment', 'condition', 'return', 'refund', 'other') then
    raise exception 'BN:invalid_category' using errcode = 'P0001';
  end if;
  if char_length(v_description) not between 10 and 1000 then
    raise exception 'BN:invalid_description' using errcode = 'P0001';
  end if;
  if (select count(*) from public.booking_disputes where booking_id = booking.id and status <> 'resolved') >= 5 then
    raise exception 'BN:too_many_issues' using errcode = 'P0001';
  end if;
  insert into public.booking_disputes (booking_id, opened_by, opened_by_role, on_behalf_of, category, description, phase_at_open, post_completion)
  values (booking.id, p_actor, p_role, p_on_behalf, p_category, v_description, booking.phase, post)
  returning id into new_id;
  insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status, reason)
  values (booking.id, p_actor, 'dispute_opened', booking.status, booking.status,
          case when p_role = 'admin' then 'BorrowNest support opened a ' || p_category || ' dispute for the ' || p_on_behalf
               else p_role || ' opened a ' || p_category || ' dispute' end
          || case when post then ' (after completion)' else '' end);
  return new_id;
end;
$$;
revoke all on function private.insert_dispute(public.bookings, uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.open_dispute(p_booking_id uuid, p_category text, p_description text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
begin
  -- Same booking lock as every handover/return confirmation.
  select * into locked from private.lock_booking_as_participant(p_booking_id);
  return private.insert_dispute(locked.booking, auth.uid(), locked.caller_role, null, p_category, p_description);
end;
$$;

-- Locks the booking, then the dispute, for its active participant.
create or replace function private.lock_dispute_as_participant(p_dispute_id uuid, out dispute public.booking_disputes, out caller_role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  locked record;
begin
  select d.booking_id into v_booking_id from public.booking_disputes d where d.id = p_dispute_id;
  if v_booking_id is null then
    raise exception 'BN:booking_not_found' using errcode = 'P0001';
  end if;
  select * into locked from private.lock_booking_as_participant(v_booking_id);
  select * into dispute from public.booking_disputes where id = p_dispute_id for update;
  caller_role := locked.caller_role;
  if dispute.status = 'resolved' then
    raise exception 'BN:dispute_resolved' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.lock_dispute_as_participant(uuid) from public, anon, authenticated;

create or replace function public.add_dispute_message(p_dispute_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  v_body text := private.clean_block(p_body);
  new_id uuid;
begin
  select * into locked from private.lock_dispute_as_participant(p_dispute_id);
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'BN:invalid_message' using errcode = 'P0001';
  end if;
  if (select count(*) from public.dispute_messages where dispute_id = p_dispute_id) >= 50 then
    raise exception 'BN:too_many_messages' using errcode = 'P0001';
  end if;
  insert into public.dispute_messages (dispute_id, author_id, author_role, kind, body)
  values (p_dispute_id, auth.uid(), locked.caller_role, 'statement', v_body)
  returning id into new_id;
  update public.booking_disputes set updated_at = pg_catalog.now() where id = p_dispute_id;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Private dispute evidence
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dispute-evidence', 'dispute-evidence', false, 5242880, array['image/webp'])
on conflict (id) do nothing;

-- Object names: <booking uuid>/<dispute uuid>/<random uuid>.webp
create or replace function private.dispute_participant_role(p_booking_id uuid, p_dispute_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when b.renter_id = (select auth.uid()) and private.has_active_role('renter'::public.user_role) then 'renter'
    when b.provider_id = (select auth.uid()) and private.is_active_provider() then 'provider'
  end
  from public.bookings b
  join public.booking_disputes d on d.booking_id = b.id and d.id = p_dispute_id
  where b.id = p_booking_id;
$$;
revoke all on function private.dispute_participant_role(uuid, uuid) from public, anon, authenticated;

create or replace function private.can_upload_dispute_evidence(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.evidence_path_parts(object_name) parts
    join public.booking_disputes d on d.id = parts.exchange_id and d.booking_id = parts.booking_id and d.status <> 'resolved'
    where private.dispute_participant_role(parts.booking_id, parts.exchange_id) is not null
  )
  and not exists (select 1 from private.attached_evidence_paths a where a.storage_path = object_name);
$$;

create or replace function private.can_read_dispute_evidence(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_admin() or exists (
    select 1 from private.evidence_path_parts(object_name) parts
    where private.dispute_participant_role(parts.booking_id, parts.exchange_id) is not null
  );
$$;
revoke all on function private.can_upload_dispute_evidence(text) from public, anon;
revoke all on function private.can_read_dispute_evidence(text) from public, anon;
grant execute on function private.can_upload_dispute_evidence(text) to authenticated;
grant execute on function private.can_read_dispute_evidence(text) to authenticated;

create policy "dispute-evidence: participants upload to unresolved disputes"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dispute-evidence' and (select private.can_upload_dispute_evidence(name)));
create policy "dispute-evidence: participants and admins read"
  on storage.objects for select to authenticated
  using (bucket_id = 'dispute-evidence' and (select private.can_read_dispute_evidence(name)));

create or replace function public.attach_dispute_evidence(p_dispute_id uuid, p_storage_path text, p_caption text, p_signature text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  v_caption text := nullif(private.clean_line(p_caption), '');
  expected text;
  new_id uuid;
begin
  select * into locked from private.lock_dispute_as_participant(p_dispute_id);
  if not exists (select 1 from private.evidence_path_parts(p_storage_path) parts
                 where parts.booking_id = (locked.dispute).booking_id and parts.exchange_id = p_dispute_id) then
    raise exception 'BN:invalid_evidence_path' using errcode = 'P0001';
  end if;
  expected := pg_catalog.encode(extensions.hmac(
    'dispute:v1:' || auth.uid()::text || ':' || p_dispute_id::text || ':' || p_storage_path,
    private.image_attestation_key(), 'sha256'), 'hex');
  if p_signature is null or p_signature <> expected then
    raise exception 'BN:invalid_image_signature' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'dispute-evidence' and o.name = p_storage_path and o.owner_id = auth.uid()::text) then
    raise exception 'BN:image_not_uploaded' using errcode = 'P0001';
  end if;
  if v_caption is not null and char_length(v_caption) > 200 then
    raise exception 'BN:invalid_caption' using errcode = 'P0001';
  end if;
  if (select count(*) from public.dispute_evidence where dispute_id = p_dispute_id) >= 10 then
    raise exception 'BN:evidence_limit' using errcode = 'P0001';
  end if;
  insert into private.attached_evidence_paths (storage_path) values (p_storage_path) on conflict do nothing;
  if not found then
    raise exception 'BN:image_already_used' using errcode = 'P0001';
  end if;
  insert into public.dispute_evidence (dispute_id, storage_path, caption, uploaded_by, uploader_role)
  values (p_dispute_id, p_storage_path, v_caption, auth.uid(), locked.caller_role)
  returning id into new_id;
  update public.booking_disputes set updated_at = pg_catalog.now() where id = p_dispute_id;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin functions (each checks for an active admin; all audited)
-- ---------------------------------------------------------------------------
-- For a participant who cannot act themselves (for example a suspended
-- account). The admin opens the case; nobody's confirmation is made for them.
create or replace function public.admin_open_dispute_for(p_booking_id uuid, p_on_behalf text, p_category text, p_description text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_active_admin();
  booking public.bookings;
  new_id uuid;
begin
  if p_on_behalf is null or p_on_behalf not in ('renter', 'provider') then
    raise exception 'BN:invalid_participant' using errcode = 'P0001';
  end if;
  select * into booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'BN:booking_not_found' using errcode = 'P0001';
  end if;
  new_id := private.insert_dispute(booking, caller, 'admin', p_on_behalf, p_category, p_description);
  perform private.write_audit(caller, 'dispute.open_on_behalf', 'booking', booking.id, left(private.clean_line(p_description), 500),
    jsonb_build_object('dispute_id', new_id, 'category', p_category, 'on_behalf_of', p_on_behalf));
  return new_id;
end;
$$;

create or replace function private.lock_dispute_as_admin(p_dispute_id uuid)
returns public.booking_disputes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  d public.booking_disputes;
begin
  select x.booking_id into v_booking_id from public.booking_disputes x where x.id = p_dispute_id;
  if v_booking_id is null then
    raise exception 'BN:dispute_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.bookings where id = v_booking_id for update;
  select * into d from public.booking_disputes where id = p_dispute_id for update;
  return d;
end;
$$;
revoke all on function private.lock_dispute_as_admin(uuid) from public, anon, authenticated;

-- In-app status only: no email or SMS is sent.
create or replace function public.admin_set_dispute_status(p_dispute_id uuid, p_status text, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_active_admin();
  d public.booking_disputes := private.lock_dispute_as_admin(p_dispute_id);
  v_note text := private.clean_block(p_note);
begin
  if p_status is null or p_status not in ('in_review', 'needs_info') then
    raise exception 'BN:invalid_status' using errcode = 'P0001';
  end if;
  if d.status = 'resolved' then
    raise exception 'BN:dispute_resolved' using errcode = 'P0001';
  end if;
  if p_status = 'needs_info' and char_length(v_note) < 10 then
    raise exception 'BN:note_required' using errcode = 'P0001';
  end if;
  if char_length(v_note) > 2000 then
    raise exception 'BN:invalid_message' using errcode = 'P0001';
  end if;
  if d.status = p_status and v_note = '' then
    return p_status;
  end if;
  update public.booking_disputes set status = p_status, updated_at = pg_catalog.now() where id = d.id;
  if v_note <> '' then
    insert into public.dispute_messages (dispute_id, author_id, author_role, kind, body)
    values (d.id, caller, 'admin', case when p_status = 'needs_info' then 'info_request' else 'status_note' end, v_note);
  end if;
  insert into public.booking_events (booking_id, actor_id, event_type, reason)
  values (d.booking_id, caller, 'dispute_status_changed',
          case when p_status = 'needs_info' then 'BorrowNest support asked for more information' else 'BorrowNest support is reviewing a dispute' end);
  perform private.write_audit(caller, 'dispute.status', 'booking', d.booking_id, nullif(left(v_note, 500), ''),
    jsonb_build_object('dispute_id', d.id, 'from', d.status, 'to', p_status));
  return p_status;
end;
$$;

create or replace function public.admin_resolve_dispute(
  p_dispute_id uuid,
  p_decision text,
  p_reason text,
  p_facts text,
  p_provider_owes_renter numeric,
  p_renter_owes_provider numeric,
  p_obligation_note text,
  p_possession text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_active_admin();
  d public.booking_disputes := private.lock_dispute_as_admin(p_dispute_id);
  booking public.bookings;
  product public.products;
  v_reason text := private.clean_block(p_reason);
  v_facts text := nullif(private.clean_block(p_facts), '');
  v_note text := nullif(private.clean_line(p_obligation_note), '');
  item_out boolean;
  resolution_id uuid;
begin
  -- Retry after success: nothing is written twice.
  if d.status = 'resolved' then
    return case when exists (select 1 from public.admin_closures c join public.dispute_resolutions r on r.id = c.resolution_id where r.dispute_id = d.id)
                then 'closed' else 'resolved' end;
  end if;
  select * into booking from public.bookings where id = d.booking_id;

  if p_decision is null or p_decision not in ('no_action', 'renter_favoured', 'provider_favoured', 'shared', 'admin_closure') then
    raise exception 'BN:invalid_decision' using errcode = 'P0001';
  end if;
  if char_length(v_reason) not between 10 and 1000 then
    raise exception 'BN:reason_required' using errcode = 'P0001';
  end if;
  if char_length(coalesce(v_facts, '')) > 2000 or char_length(coalesce(v_note, '')) > 500 then
    raise exception 'BN:reason_too_long' using errcode = 'P0001';
  end if;
  if p_provider_owes_renter is null or p_renter_owes_provider is null
     or p_provider_owes_renter < 0 or p_renter_owes_provider < 0
     or p_provider_owes_renter > 1000000 or p_renter_owes_provider > 1000000
     or p_provider_owes_renter <> round(p_provider_owes_renter, 2) or p_renter_owes_provider <> round(p_renter_owes_provider, 2) then
    raise exception 'BN:invalid_amount' using errcode = 'P0001';
  end if;
  if p_possession is null or p_possession not in ('not_applicable', 'with_renter', 'returned_to_provider', 'lost', 'damaged') then
    raise exception 'BN:invalid_possession' using errcode = 'P0001';
  end if;
  -- While the item may be with the renter, the decision must say where it is.
  item_out := booking.status = 'confirmed' and booking.phase in ('active', 'return_requested');
  if item_out and p_possession = 'not_applicable' then
    raise exception 'BN:possession_required' using errcode = 'P0001';
  end if;

  if p_decision = 'admin_closure' then
    if not item_out then
      raise exception 'BN:closure_not_applicable' using errcode = 'P0001';
    end if;
    if p_possession not in ('returned_to_provider', 'lost', 'damaged') then
      raise exception 'BN:possession_unresolved' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.booking_disputes o where o.booking_id = d.booking_id and o.id <> d.id and o.status <> 'resolved' and not o.post_completion) then
      raise exception 'BN:other_disputes_open' using errcode = 'P0001';
    end if;
  end if;

  insert into public.dispute_resolutions (dispute_id, admin_id, decision, reason, acknowledged_facts, provider_owes_renter,
                                          renter_owes_provider, obligation_note, possession_outcome)
  values (d.id, caller, p_decision, v_reason, v_facts, p_provider_owes_renter, p_renter_owes_provider, v_note, p_possession)
  returning id into resolution_id;
  update public.booking_disputes
  set status = 'resolved', resolved_by = caller, resolved_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = d.id;
  insert into public.booking_events (booking_id, actor_id, event_type, reason)
  values (d.booking_id, caller, 'dispute_resolved', 'Admin resolved a ' || d.category || ' dispute (' || replace(p_decision, '_', ' ') || ')');
  perform private.write_audit(caller, 'dispute.resolve', 'booking', d.booking_id, left(v_reason, 500),
    jsonb_build_object('dispute_id', d.id, 'category', d.category, 'decision', p_decision, 'possession', p_possession,
                       'provider_owes_renter', p_provider_owes_renter, 'renter_owes_provider', p_renter_owes_provider));

  if p_decision <> 'admin_closure' then
    return 'resolved';
  end if;

  insert into public.admin_closures (booking_id, resolution_id, admin_id, possession_outcome, provider_owes_renter_outstanding,
                                     renter_owes_provider_outstanding, reason)
  values (booking.id, resolution_id, caller, p_possession, p_provider_owes_renter, p_renter_owes_provider, v_reason);
  update public.bookings set status = 'closed' where id = booking.id;
  insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status, reason)
  values (booking.id, caller, 'admin_closed', 'confirmed', 'closed', 'Closed by BorrowNest support; item ' || replace(p_possession, '_', ' '));
  perform private.write_audit(caller, 'booking.admin_close', 'booking', booking.id, left(v_reason, 500),
    jsonb_build_object('dispute_id', d.id, 'possession', p_possession,
                       'provider_owes_renter_outstanding', p_provider_owes_renter, 'renter_owes_provider_outstanding', p_renter_owes_provider));

  if p_possession in ('lost', 'damaged') then
    select * into product from public.products where id = booking.product_id for update;
    update public.products
    set inventory_hold = p_possession,
        listing_status = case when listing_status = 'published' then 'paused'::public.listing_status else listing_status end
    where id = product.id;
    perform private.write_audit(caller, 'listing.inventory_hold', 'product', product.id, left(v_reason, 500),
      jsonb_build_object('title', product.title, 'hold', p_possession, 'from', product.listing_status,
                         'to', case when product.listing_status = 'published' then 'paused' else product.listing_status::text end, 'booking_id', booking.id));
  end if;
  return 'closed';
end;
$$;

create or replace function public.admin_release_inventory_hold(p_product_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_active_admin();
  v_reason text := private.require_reason(p_reason, 10);
  product public.products;
begin
  select * into product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'BN:product_not_found' using errcode = 'P0001';
  end if;
  if product.inventory_hold is null then
    return 'released';
  end if;
  update public.products set inventory_hold = null where id = product.id;
  perform private.write_audit(caller, 'listing.inventory_release', 'product', product.id, v_reason,
    jsonb_build_object('title', product.title, 'hold', product.inventory_hold));
  return 'released';
end;
$$;

-- Bounded admin queue. p_status: null = needing attention, 'all', or one status.
create or replace function public.admin_list_disputes(p_status text, p_limit integer, p_offset integer)
returns table (
  id uuid, booking_id uuid, product_title text, category text, status text, opened_by_role text, on_behalf_of text,
  post_completion boolean, booking_status public.booking_status, booking_phase public.rental_phase,
  message_count bigint, created_at timestamptz, updated_at timestamptz, total_count bigint
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
  if p_status is not null and p_status not in ('all', 'open', 'in_review', 'needs_info', 'resolved') then
    raise exception 'BN:invalid_status' using errcode = 'P0001';
  end if;
  return query
  select d.id, d.booking_id, p.title, d.category, d.status, d.opened_by_role, d.on_behalf_of, d.post_completion,
         b.status, b.phase, (select count(*) from public.dispute_messages m where m.dispute_id = d.id),
         d.created_at, d.updated_at, count(*) over ()
  from public.booking_disputes d
  join public.bookings b on b.id = d.booking_id
  join public.products p on p.id = b.product_id
  where (p_status is null and d.status <> 'resolved')
     or p_status = 'all'
     or d.status = p_status
  order by (d.status = 'resolved'), d.created_at, d.id
  limit page_size offset page_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.dispute_resolutions enable row level security;
alter table public.dispute_messages enable row level security;
alter table public.dispute_evidence enable row level security;
alter table public.admin_closures enable row level security;
revoke all on table public.booking_disputes, public.dispute_resolutions, public.dispute_messages, public.dispute_evidence,
  public.admin_closures from public, anon, authenticated;
grant select on table public.booking_disputes, public.dispute_resolutions, public.dispute_messages, public.dispute_evidence,
  public.admin_closures to authenticated;
grant select, insert, update, delete on table public.dispute_resolutions, public.dispute_messages, public.dispute_evidence,
  public.admin_closures to service_role;

alter policy "booking_issues: with their booking" on public.booking_disputes rename to "booking_disputes: with their booking";
-- The bookings subquery is itself RLS-filtered (active participant or admin).
create policy "dispute_resolutions: with their dispute" on public.dispute_resolutions for select to authenticated
  using (exists (select 1 from public.booking_disputes d where d.id = dispute_resolutions.dispute_id));
create policy "dispute_messages: with their dispute" on public.dispute_messages for select to authenticated
  using (exists (select 1 from public.booking_disputes d where d.id = dispute_messages.dispute_id));
create policy "dispute_evidence: with their dispute" on public.dispute_evidence for select to authenticated
  using (exists (select 1 from public.booking_disputes d where d.id = dispute_evidence.dispute_id));
create policy "admin_closures: with their booking" on public.admin_closures for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = admin_closures.booking_id));

revoke all on function public.open_dispute(uuid, text, text) from public, anon;
revoke all on function public.add_dispute_message(uuid, text) from public, anon;
revoke all on function public.attach_dispute_evidence(uuid, text, text, text) from public, anon;
revoke all on function public.admin_open_dispute_for(uuid, text, text, text) from public, anon;
revoke all on function public.admin_set_dispute_status(uuid, text, text) from public, anon;
revoke all on function public.admin_resolve_dispute(uuid, text, text, text, numeric, numeric, text, text) from public, anon;
revoke all on function public.admin_release_inventory_hold(uuid, text) from public, anon;
revoke all on function public.admin_list_disputes(text, integer, integer) from public, anon;
grant execute on function public.open_dispute(uuid, text, text) to authenticated;
grant execute on function public.add_dispute_message(uuid, text) to authenticated;
grant execute on function public.attach_dispute_evidence(uuid, text, text, text) to authenticated;
grant execute on function public.admin_open_dispute_for(uuid, text, text, text) to authenticated;
grant execute on function public.admin_set_dispute_status(uuid, text, text) to authenticated;
grant execute on function public.admin_resolve_dispute(uuid, text, text, text, numeric, numeric, text, text) to authenticated;
grant execute on function public.admin_release_inventory_hold(uuid, text) to authenticated;
grant execute on function public.admin_list_disputes(text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Existing functions rechecked against disputes (generated below)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_handover(p_exchange_id uuid, p_revision integer, p_acknowledgements text[])
 RETURNS rental_phase
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if private.has_active_hold(v_booking_id) then
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
$function$;

CREATE OR REPLACE FUNCTION public.confirm_return(p_exchange_id uuid, p_revision integer, p_deduction numeric, p_refund numeric, p_acknowledgements text[])
 RETURNS rental_phase
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking_id uuid;
  locked record;
  x public.booking_exchanges;
  required text[];
  confirmed_roles integer;
begin
  select e.booking_id into v_booking_id from public.booking_exchanges e where e.id = p_exchange_id and e.kind = 'return';
  if v_booking_id is null then
    raise exception 'BN:booking_not_found' using errcode = 'P0001';
  end if;
  select * into locked from private.lock_booking_as_participant(v_booking_id);
  select * into x from public.booking_exchanges where id = p_exchange_id for update;

  if (locked.booking).status = 'completed'
     and exists (select 1 from public.exchange_confirmations c where c.exchange_id = x.id and c.participant_id = auth.uid()) then
    return 'returned';
  end if;

  perform private.assert_return_open(locked.booking);
  if x.status <> 'current' or x.revision <> p_revision then
    raise exception 'BN:stale_revision' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.booking_exchanges h
    where h.booking_id = v_booking_id and h.kind = 'handover' and h.status = 'current'
      and (select count(distinct c.participant_role) from public.exchange_confirmations c where c.exchange_id = h.id) = 2
  ) then
    raise exception 'BN:handover_not_confirmed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.return_proposals rp where rp.booking_id = v_booking_id and rp.status = 'accepted') then
    raise exception 'BN:return_not_scheduled' using errcode = 'P0001';
  end if;
  if x.rent_amount <> (locked.booking).rental_amount or x.deposit_amount <> (locked.booking).deposit
     or x.refund_due <> x.deposit_amount - x.deduction_amount then
    raise exception 'BN:amount_mismatch' using errcode = 'P0001';
  end if;
  if p_deduction is null or p_refund is null or p_deduction <> x.deduction_amount or p_refund <> x.refund_due then
    raise exception 'BN:settlement_mismatch' using errcode = 'P0001';
  end if;
  if private.has_active_hold(v_booking_id) then
    raise exception 'BN:issue_open' using errcode = 'P0001';
  end if;

  required := case locked.caller_role
    when 'renter' then array['returned_item', 'settlement_agreed', 'refund_received']
    else array['received_item', 'condition_matches', 'refund_paid'] end;
  if p_acknowledgements is null or not (p_acknowledgements @> required and required @> p_acknowledgements) then
    raise exception 'BN:acknowledgements_required' using errcode = 'P0001';
  end if;

  insert into public.exchange_confirmations (exchange_id, participant_id, participant_role, acknowledged)
  values (x.id, auth.uid(), locked.caller_role, required)
  on conflict (exchange_id, participant_id) do nothing;
  if found then
    insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status, reason)
    values (v_booking_id, auth.uid(), 'return_confirmed', 'confirmed', 'confirmed', locked.caller_role || ' confirmed return revision ' || x.revision);
  end if;

  select count(distinct participant_role) into confirmed_roles from public.exchange_confirmations where exchange_id = x.id;
  if confirmed_roles = 2 then
    update public.bookings set phase = 'returned', status = 'completed' where id = v_booking_id;
    insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status)
    values (v_booking_id, auth.uid(), 'rental_completed', 'confirmed', 'completed');
    return 'returned';
  end if;
  return 'return_requested';
end;
$function$;

CREATE OR REPLACE FUNCTION public.product_blocked_dates(p_product_id uuid, p_from date, p_to date)
 RETURNS TABLE(blocked_date date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_from date := greatest(coalesce(p_from, private.gwalior_today()), private.gwalior_today());
  v_to date;
begin
  v_to := least(coalesce(p_to, v_from + 180), v_from + 400);
  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.listing_status = 'published' and private.is_eligible_provider(p.provider_id)
  ) then
    return;
  end if;
  return query
  select distinct d::date
  from public.bookings b,
       pg_catalog.generate_series(greatest(b.start_date, v_from), least(b.end_date, v_to), interval '1 day') d
  where b.product_id = p_product_id
    and b.status in ('confirmed', 'completed', 'closed')
    and b.end_date >= v_from and b.start_date <= v_to
  order by 1;
end;
$function$;

