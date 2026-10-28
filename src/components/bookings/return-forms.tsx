"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useState } from "react";

import { FormMessage, SelectField, TextAreaField, TextField } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/actions";
import {
  acceptReturnAction,
  prepareReturnAction,
  proposeReturnAction,
  reviseReturnAction,
} from "@/lib/bookings/handover-actions";
import { checkSettlement } from "@/lib/bookings/settlement";
import { formatInr } from "@/lib/utils";

const INITIAL: FormState = { status: "idle" };

const REFUND_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
] as const;

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" className="h-9" disabled={pending}>
      {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

/** Proposes or counter-proposes a return time, in Gwalior time (IST). */
export function ProposeReturnForm({
  bookingId,
  expectedVersion,
  minDate,
  maxDate,
  label,
  collapsed = false,
}: {
  bookingId: string;
  expectedVersion: number;
  minDate: string;
  maxDate: string;
  label: string;
  collapsed?: boolean;
}) {
  const [state, formAction, pending] = useActionState(proposeReturnAction, INITIAL);
  const [open, setOpen] = useState(!collapsed);
  if (!open && state.status !== "error") {
    return (
      <Button type="button" variant="outline" className="h-9 justify-self-start" onClick={() => setOpen(true)}>
        {label}…
      </Button>
    );
  }
  return (
    <form action={formAction} className="grid gap-4 rounded-lg border border-border bg-muted/40 p-4" noValidate>
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <p className="text-sm font-semibold">{label}</p>
      <FormMessage status={state.status} message={state.message} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="returnDate"
          type="date"
          label="Return date"
          min={minDate}
          max={maxDate}
          defaultValue={state.values?.returnDate}
          error={state.fieldErrors?.returnDate}
        />
        <TextField
          name="returnTime"
          type="time"
          label="Time (Gwalior, IST)"
          defaultValue={state.values?.returnTime ?? "18:00"}
          error={state.fieldErrors?.returnTime}
        />
      </div>
      <TextField
        name="note"
        label="Note (optional)"
        maxLength={300}
        defaultValue={state.values?.note}
        error={state.fieldErrors?.note}
      />
      <p className="text-xs text-muted-foreground">
        The other participant accepts or suggests another time. Returning early keeps the full booking and rent; extensions aren’t supported.
      </p>
      <div className="flex flex-wrap gap-2">
        <Submit pending={pending}>Send proposal</Submit>
        {collapsed ? (
          <Button type="button" variant="ghost" className="h-9" disabled={pending} onClick={() => setOpen(false)}>
            Back
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function AcceptReturnForm({ bookingId, proposalId, when }: { bookingId: string; proposalId: string; when: string }) {
  const [state, formAction, pending] = useActionState(acceptReturnAction, INITIAL);
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <FormMessage status={state.status} message={state.message} />
      <div>
        <Submit pending={pending}>Accept {when}</Submit>
      </div>
    </form>
  );
}

function SettlementFields({
  idPrefix,
  depositPaise,
  values,
  errors,
}: {
  idPrefix: string;
  depositPaise: number;
  values: { conditionNotes?: string; deduction?: string; deductionReason?: string; refundMethod?: string };
  errors: Partial<Record<string, string>> | undefined;
}) {
  // Inputs stay uncontrolled so React's post-action form reset keeps the
  // submitted values; the state only drives the live preview.
  const [deduction, setDeduction] = useState(values.deduction ?? "0");
  const [reason, setReason] = useState(values.deductionReason ?? "");
  const preview = checkSettlement({ depositPaise, deduction, reason, refundMethod: "cash" });
  const deductionPaise = preview.ok ? preview.deductionPaise : null;
  const refundPaise = deductionPaise === null || deductionPaise > depositPaise ? null : depositPaise - deductionPaise;

  return (
    <>
      <TextAreaField
        name="conditionNotes"
        fieldId={`${idPrefix}-condition`}
        label="Condition of the item when returned"
        rows={3}
        maxLength={1000}
        defaultValue={values.conditionNotes}
        error={errors?.conditionNotes}
      />
      <TextField
        name="deduction"
        label="Deduction from the deposit (₹)"
        inputMode="decimal"
        defaultValue={values.deduction ?? "0"}
        onChange={(e) => setDeduction(e.target.value)}
        hint={`Between ₹0 and ${formatInr(depositPaise / 100)}. Only what you both agree; extra claims need a dispute.`}
        error={errors?.deduction}
      />
      <TextField
        name="deductionReason"
        label="Reason for the deduction"
        maxLength={500}
        defaultValue={values.deductionReason ?? ""}
        onChange={(e) => setReason(e.target.value)}
        hint="Required when anything is deducted."
        error={errors?.deductionReason}
      />
      <dl className="grid gap-1 rounded-lg border border-border bg-card p-3 text-sm" aria-live="polite">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Deposit held</dt>
          <dd className="tabular-nums">{formatInr(depositPaise / 100)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Deduction</dt>
          <dd className="tabular-nums">{deductionPaise === null ? "—" : `− ${formatInr(deductionPaise / 100)}`}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-border pt-1 font-semibold">
          <dt>Refund due to the renter</dt>
          <dd className="tabular-nums">{refundPaise === null ? "—" : formatInr(refundPaise / 100)}</dd>
        </div>
      </dl>
      {refundPaise === 0 ? (
        <input type="hidden" name="refundMethod" value="none" />
      ) : (
        <SelectField
          name="refundMethod"
          label="How the refund is paid (offline)"
          options={REFUND_OPTIONS}
          placeholder="Choose a method"
          defaultValue={values.refundMethod && values.refundMethod !== "none" ? values.refundMethod : ""}
          error={errors?.refundMethod}
        />
      )}
    </>
  );
}

export function PrepareReturnForm({ bookingId, depositPaise }: { bookingId: string; depositPaise: number }) {
  const [state, formAction, pending] = useActionState(prepareReturnAction, INITIAL);
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <input type="hidden" name="bookingId" value={bookingId} />
      <FormMessage status={state.status} message={state.message} />
      <SettlementFields idPrefix={`prepare-${bookingId}`} depositPaise={depositPaise} values={state.values ?? {}} errors={state.fieldErrors} />
      <div>
        <Submit pending={pending}>Share return summary</Submit>
      </div>
    </form>
  );
}

export function ReviseReturnForm({
  bookingId,
  exchangeId,
  revision,
  depositPaise,
  current,
}: {
  bookingId: string;
  exchangeId: string;
  revision: number;
  depositPaise: number;
  current: { conditionNotes: string; deduction: string; deductionReason: string; refundMethod: string };
}) {
  const [state, formAction, pending] = useActionState(reviseReturnAction, INITIAL);
  const [open, setOpen] = useState(false);
  if (!open && state.status !== "error") {
    return (
      <Button type="button" variant="outline" className="h-9 justify-self-start" onClick={() => setOpen(true)}>
        Request a correction…
      </Button>
    );
  }
  return (
    <form action={formAction} className="grid gap-4 rounded-lg border border-border bg-muted/40 p-4" noValidate>
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="exchangeId" value={exchangeId} />
      <input type="hidden" name="revision" value={revision} />
      <p className="text-sm font-semibold">Correct the return summary</p>
      <p className="text-sm text-muted-foreground">
        This creates a new version. Any confirmation already given stops counting, and both of you confirm the new version.
      </p>
      <FormMessage status={state.status} message={state.message} />
      <SettlementFields idPrefix={`revise-${exchangeId}`} depositPaise={depositPaise} values={state.values ?? current} errors={state.fieldErrors} />
      <TextAreaField
        name="reason"
        fieldId={`revise-return-reason-${exchangeId}`}
        label="What needs correcting"
        rows={2}
        maxLength={500}
        defaultValue={state.values?.reason}
        error={state.fieldErrors?.reason}
      />
      <div className="flex flex-wrap gap-2">
        <Submit pending={pending}>Send correction</Submit>
        <Button type="button" variant="ghost" className="h-9" disabled={pending} onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </form>
  );
}
