-- BorrowNest Stage 9: mutual return scheduling and deposit settlement.
--
-- Participants agree a return time (propose / counter / accept), then the
-- provider prepares a return summary: actual condition, the deposit, an
-- agreed deduction and the refund due. The booking completes only when both
-- participants confirm the same revision. Nothing completes on a timer or on
-- one person's click. Booking dates and amounts are never changed; an early
-- return keeps the full reservation and rent. Lock order: booking, then
-- proposal or exchange.

-- ---------------------------------------------------------------------------
-- Return proposals
-- ---------------------------------------------------------------------------
create table public.return_proposals (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  version integer not null constraint return_proposals_version_positive check (version >= 1),
  proposed_by uuid not null,
  proposer_role text not null constraint return_proposals_role check (proposer_role in ('renter', 'provider')),
  proposed_at timestamptz not null,
  note text constraint return_proposals_note_length check (char_length(note) <= 300),
  status text not null default 'pending' constraint return_proposals_status check (status in ('pending', 'accepted', 'superseded')),
  responded_by uuid,
  responded_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint return_proposals_version_unique unique (booking_id, version),
  constraint return_proposals_not_self_accepted check (responded_by is null or responded_by <> proposed_by)
);
create unique index return_proposals_one_current on public.return_proposals (booking_id) where status in ('pending', 'accepted');

-- Only pending -> accepted and pending/accepted -> superseded; content is fixed.
create or replace function private.protect_return_proposal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.booking_id, new.version, new.proposed_by, new.proposer_role, new.proposed_at, new.note, new.created_at)
     is distinct from
     (old.booking_id, old.version, old.proposed_by, old.proposer_role, old.proposed_at, old.note, old.created_at)
     or old.status = 'superseded'
     or (old.status = 'accepted' and new.status <> 'superseded')
     or (new.status = 'accepted' and (new.responded_by is null or new.responded_at is null)) then
    raise exception 'BN:proposal_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_return_proposal() from public, anon, authenticated;
create trigger return_proposals_protect before update on public.return_proposals
  for each row execute function private.protect_return_proposal();

-- ---------------------------------------------------------------------------
-- Settlement columns on return exchanges
-- ---------------------------------------------------------------------------
alter table public.booking_exchanges
  add column deduction_amount numeric(12, 2),
  add column deduction_reason text constraint booking_exchanges_deduction_reason_length check (char_length(deduction_reason) <= 500),
  add column refund_due numeric(12, 2) generated always as (deposit_amount - deduction_amount) stored;

alter table public.booking_exchanges drop constraint booking_exchanges_payment_method;
alter table public.booking_exchanges add constraint booking_exchanges_payment_method
  check (payment_method in ('cash', 'upi', 'bank_transfer', 'none'));
-- Handover rows carry no settlement. Return rows: 0 <= deduction <= deposit,
-- a reason for any deduction, and "none" as the method exactly when nothing
-- is refunded.
alter table public.booking_exchanges add constraint booking_exchanges_settlement check (
  (kind = 'handover' and deduction_amount is null and deduction_reason is null and payment_method <> 'none')
  or (kind = 'return' and deduction_amount is not null and deduction_amount >= 0 and deduction_amount <= deposit_amount
      and (deduction_amount = 0 or char_length(coalesce(deduction_reason, '')) >= 5)
      and ((deposit_amount - deduction_amount = 0) = (payment_method = 'none')))
);

create or replace function private.protect_exchange_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.booking_id, new.kind, new.revision, new.created_by, new.rent_amount, new.deposit_amount,
      new.payment_method, new.condition_notes, new.change_reason, new.scheduled_at, new.created_at,
      new.deduction_amount, new.deduction_reason)
     is distinct from
     (old.booking_id, old.kind, old.revision, old.created_by, old.rent_amount, old.deposit_amount,
      old.payment_method, old.condition_notes, old.change_reason, old.scheduled_at, old.created_at,
      old.deduction_amount, old.deduction_reason)
     or (old.status = 'superseded') then
    raise exception 'BN:exchange_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Event vocabulary.
alter table public.booking_events drop constraint booking_events_type_allowed;
alter table public.booking_events add constraint booking_events_type_allowed check (event_type in (
  'request_created', 'request_confirmed', 'request_rejected', 'request_cancelled', 'admin_cancelled',
  'handover_prepared', 'handover_revised', 'handover_confirmed', 'rental_activated', 'issue_reported', 'issue_resolved',
  'return_proposed', 'return_accepted', 'return_prepared', 'return_revised', 'return_confirmed', 'rental_completed'
));

-- ---------------------------------------------------------------------------
-- Phase transitions (replaces the Stage 8 activation check)
-- ---------------------------------------------------------------------------
-- Every phase change must follow the workflow, even for trusted code:
--   awaiting_handover -> active          both confirmed the current handover
--   active -> return_requested           a current proposal is accepted
--   return_requested -> active           rescheduling, before any return summary
--   return_requested -> returned         both confirmed the current return (status completed)
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

-- Completion is only reachable through the returned phase above.
create or replace function private.check_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status <> 'completed' and not (old.phase = 'return_requested' and new.phase = 'returned') then
    raise exception 'BN:completion_requires_both_confirmations' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.check_completion() from public, anon, authenticated;
create trigger bookings_check_completion before update on public.bookings
  for each row execute function private.check_completion();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.assert_return_open(booking public.bookings)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  -- No time limit: a late return is still recorded, at its actual time.
  if booking.status <> 'confirmed' or booking.phase <> 'return_requested' then
    raise exception 'BN:return_not_open' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.assert_return_open(public.bookings) from public, anon, authenticated;

create or replace function private.valid_settlement(p_deposit numeric, p_deduction numeric, p_reason text, p_method text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_deduction is null or p_deduction < 0 or p_deduction > p_deposit or p_deduction <> round(p_deduction, 2) then
    raise exception 'BN:invalid_deduction' using errcode = 'P0001';
  end if;
  if p_deduction > 0 and char_length(coalesce(p_reason, '')) < 5 then
    raise exception 'BN:deduction_reason_required' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_reason, '')) > 500 then
    raise exception 'BN:reason_too_long' using errcode = 'P0001';
  end if;
  -- Nothing to refund: the method is "none" whatever was sent.
  if p_deposit - p_deduction = 0 then
    return 'none';
  end if;
  if p_method is null or p_method not in ('cash', 'upi', 'bank_transfer') then
    raise exception 'BN:invalid_payment_method' using errcode = 'P0001';
  end if;
  return p_method;
end;
$$;
revoke all on function private.valid_settlement(numeric, numeric, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------
-- p_expected_version is the latest proposal version the caller saw (0 for
-- none), so two people proposing at once cannot silently overwrite.
create or replace function public.propose_return(
  p_booking_id uuid, p_proposed_at timestamptz, p_note text, p_expected_version integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  current_p public.return_proposals;
  latest integer;
  v_note text := nullif(private.clean_line(p_note), '');
  new_id uuid;
begin
  select * into locked from private.lock_booking_as_participant(p_booking_id);
  if (locked.booking).status <> 'confirmed' or (locked.booking).phase not in ('active', 'return_requested') then
    raise exception 'BN:rental_not_active' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.booking_exchanges x where x.booking_id = p_booking_id and x.kind = 'return') then
    raise exception 'BN:return_in_progress' using errcode = 'P0001';
  end if;
  select coalesce(max(version), 0) into latest from public.return_proposals where booking_id = p_booking_id;
  if p_expected_version is distinct from latest then
    raise exception 'BN:stale_proposal' using errcode = 'P0001';
  end if;
  if p_proposed_at is null or p_proposed_at <= pg_catalog.now() then
    raise exception 'BN:proposal_in_past' using errcode = 'P0001';
  end if;
  if pg_catalog.now() < (locked.booking).return_at then
    if p_proposed_at > (locked.booking).return_at then
      raise exception 'BN:after_scheduled_return' using errcode = 'P0001';
    end if;
  elsif p_proposed_at > pg_catalog.now() + interval '7 days' then
    -- Overdue: a late exchange can be arranged soon, never as an extension.
    raise exception 'BN:late_return_too_far' using errcode = 'P0001';
  end if;
  if char_length(coalesce(v_note, '')) > 300 then
    raise exception 'BN:invalid_note' using errcode = 'P0001';
  end if;

  select * into current_p from public.return_proposals
  where booking_id = p_booking_id and status in ('pending', 'accepted') for update;
  if current_p.id is not null then
    update public.return_proposals set status = 'superseded' where id = current_p.id;
    if current_p.status = 'accepted' then
      update public.bookings set phase = 'active' where id = p_booking_id;
    end if;
  end if;

  insert into public.return_proposals (booking_id, version, proposed_by, proposer_role, proposed_at, note)
  values (p_booking_id, latest + 1, auth.uid(), locked.caller_role, p_proposed_at, v_note)
  returning id into new_id;
  insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status, reason)
  values (p_booking_id, auth.uid(), 'return_proposed', 'confirmed', 'confirmed',
          locked.caller_role || ' proposed ' || pg_catalog.to_char(p_proposed_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI') || ' IST');
  return new_id;
end;
$$;

create or replace function public.accept_return(p_proposal_id uuid)
returns public.rental_phase
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  locked record;
  p public.return_proposals;
begin
  select rp.booking_id into v_booking_id from public.return_proposals rp where rp.id = p_proposal_id;
  if v_booking_id is null then
    raise exception 'BN:booking_not_found' using errcode = 'P0001';
  end if;
  select * into locked from private.lock_booking_as_participant(v_booking_id);
  select * into p from public.return_proposals where id = p_proposal_id for update;
  if p.proposed_by = auth.uid() then
    raise exception 'BN:cannot_accept_own_proposal' using errcode = 'P0001';
  end if;
  -- Repeat by the same person: no-op.
  if p.status = 'accepted' and p.responded_by = auth.uid() then
    return (locked.booking).phase;
  end if;
  if p.status <> 'pending' then
    raise exception 'BN:stale_proposal' using errcode = 'P0001';
  end if;
  if (locked.booking).status <> 'confirmed' or (locked.booking).phase <> 'active' then
    raise exception 'BN:rental_not_active' using errcode = 'P0001';
  end if;
  if p.proposed_at <= pg_catalog.now() then
    raise exception 'BN:proposal_in_past' using errcode = 'P0001';
  end if;

  update public.return_proposals set status = 'accepted', responded_by = auth.uid(), responded_at = pg_catalog.now() where id = p.id;
  update public.bookings set phase = 'return_requested' where id = v_booking_id;
  insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status, reason)
  values (v_booking_id, auth.uid(), 'return_accepted', 'confirmed', 'confirmed',
          locked.caller_role || ' accepted ' || pg_catalog.to_char(p.proposed_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI') || ' IST');
  return 'return_requested';
end;
$$;

-- ---------------------------------------------------------------------------
-- Return summary and settlement
-- ---------------------------------------------------------------------------
create or replace function public.prepare_return(
  p_booking_id uuid, p_condition_notes text, p_deduction numeric, p_deduction_reason text, p_refund_method text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
  v_notes text := private.clean_block(p_condition_notes);
  v_reason text := nullif(private.clean_line(p_deduction_reason), '');
  v_method text;
  v_scheduled timestamptz;
  new_id uuid;
begin
  select * into locked from private.lock_booking_as_participant(p_booking_id);
  if locked.caller_role <> 'provider' then
    raise exception 'BN:provider_prepares_return' using errcode = 'P0001';
  end if;
  perform private.assert_return_open(locked.booking);
  if exists (select 1 from public.booking_exchanges where booking_id = p_booking_id and kind = 'return') then
    raise exception 'BN:return_exists' using errcode = 'P0001';
  end if;
  select proposed_at into v_scheduled from public.return_proposals where booking_id = p_booking_id and status = 'accepted';
  if v_scheduled is null then
    raise exception 'BN:return_not_scheduled' using errcode = 'P0001';
  end if;
  if char_length(v_notes) not between 3 and 1000 then
    raise exception 'BN:invalid_condition_notes' using errcode = 'P0001';
  end if;
  v_method := private.valid_settlement((locked.booking).deposit, p_deduction, v_reason, p_refund_method);

  insert into public.booking_exchanges (booking_id, kind, revision, created_by, rent_amount, deposit_amount, payment_method,
                                        condition_notes, scheduled_at, deduction_amount, deduction_reason)
  values (p_booking_id, 'return', 1, auth.uid(), (locked.booking).rental_amount, (locked.booking).deposit, v_method,
          v_notes, v_scheduled, p_deduction, case when p_deduction > 0 then v_reason end)
  returning id into new_id;
  insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status)
  values (p_booking_id, auth.uid(), 'return_prepared', 'confirmed', 'confirmed');
  return new_id;
end;
$$;

create or replace function public.revise_return(
  p_exchange_id uuid, p_expected_revision integer, p_condition_notes text, p_deduction numeric,
  p_deduction_reason text, p_refund_method text, p_reason text
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
  v_ded_reason text := nullif(private.clean_line(p_deduction_reason), '');
  v_reason text := private.require_reason(p_reason, 5);
  v_method text;
  new_id uuid;
begin
  select x.booking_id into v_booking_id from public.booking_exchanges x where x.id = p_exchange_id and x.kind = 'return';
  if v_booking_id is null then
    raise exception 'BN:booking_not_found' using errcode = 'P0001';
  end if;
  select * into locked from private.lock_booking_as_participant(v_booking_id);
  perform private.assert_return_open(locked.booking);
  select * into current_x from public.booking_exchanges
  where booking_id = v_booking_id and kind = 'return' and status = 'current' for update;
  if current_x.id is distinct from p_exchange_id or current_x.revision is distinct from p_expected_revision then
    raise exception 'BN:stale_revision' using errcode = 'P0001';
  end if;
  if char_length(v_notes) not between 3 and 1000 then
    raise exception 'BN:invalid_condition_notes' using errcode = 'P0001';
  end if;
  v_method := private.valid_settlement(current_x.deposit_amount, p_deduction, v_ded_reason, p_refund_method);
  if p_deduction = 0 then
    v_ded_reason := null;
  end if;
  if v_notes = current_x.condition_notes and p_deduction = current_x.deduction_amount
     and v_ded_reason is not distinct from current_x.deduction_reason and v_method = current_x.payment_method then
    raise exception 'BN:no_change' using errcode = 'P0001';
  end if;

  update public.booking_exchanges set status = 'superseded', superseded_at = pg_catalog.now() where id = current_x.id;
  insert into public.booking_exchanges (booking_id, kind, revision, created_by, rent_amount, deposit_amount, payment_method,
                                        condition_notes, change_reason, scheduled_at, deduction_amount, deduction_reason)
  values (v_booking_id, 'return', current_x.revision + 1, auth.uid(), current_x.rent_amount, current_x.deposit_amount, v_method,
          v_notes, v_reason, current_x.scheduled_at, p_deduction, v_ded_reason)
  returning id into new_id;
  insert into public.exchange_evidence (exchange_id, storage_path, caption, uploaded_by, created_at)
  select new_id, e.storage_path, e.caption, e.uploaded_by, e.created_at from public.exchange_evidence e where e.exchange_id = current_x.id;
  insert into public.booking_events (booking_id, actor_id, event_type, previous_status, next_status, reason)
  values (v_booking_id, auth.uid(), 'return_revised', 'confirmed', 'confirmed', v_reason);
  return new_id;
end;
$$;

-- p_deduction and p_refund are what the caller saw; a mismatch means the
-- summary changed or the request was tampered with.
create or replace function public.confirm_return(
  p_exchange_id uuid, p_revision integer, p_deduction numeric, p_refund numeric, p_acknowledgements text[]
)
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
  if exists (select 1 from public.booking_issues i where i.booking_id = v_booking_id and i.status = 'open') then
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
$$;

-- ---------------------------------------------------------------------------
-- Evidence for return exchanges
-- ---------------------------------------------------------------------------
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
    join public.bookings b on b.id = parts.booking_id and b.status = 'confirmed'
      and ((x.kind = 'handover' and b.phase = 'awaiting_handover') or (x.kind = 'return' and b.phase = 'return_requested'))
    where private.is_exchange_participant(parts.booking_id, parts.exchange_id)
  )
  and not exists (select 1 from private.attached_evidence_paths a where a.storage_path = object_name);
$$;

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
  if x.kind = 'handover' then
    perform private.assert_handover_open(locked.booking);
  else
    perform private.assert_return_open(locked.booking);
  end if;
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
-- Access
-- ---------------------------------------------------------------------------
alter table public.return_proposals enable row level security;
revoke all on table public.return_proposals from public, anon, authenticated;
grant select on table public.return_proposals to authenticated;
grant select, insert, update, delete on table public.return_proposals to service_role;
create policy "return_proposals: with their booking" on public.return_proposals for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = return_proposals.booking_id));

revoke all on function public.propose_return(uuid, timestamptz, text, integer) from public, anon;
revoke all on function public.accept_return(uuid) from public, anon;
revoke all on function public.prepare_return(uuid, text, numeric, text, text) from public, anon;
revoke all on function public.revise_return(uuid, integer, text, numeric, text, text, text) from public, anon;
revoke all on function public.confirm_return(uuid, integer, numeric, numeric, text[]) from public, anon;
grant execute on function public.propose_return(uuid, timestamptz, text, integer) to authenticated;
grant execute on function public.accept_return(uuid) to authenticated;
grant execute on function public.prepare_return(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.revise_return(uuid, integer, text, numeric, text, text, text) to authenticated;
grant execute on function public.confirm_return(uuid, integer, numeric, numeric, text[]) to authenticated;
