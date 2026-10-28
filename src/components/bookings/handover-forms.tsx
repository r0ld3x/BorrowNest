"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useState } from "react";

import { FormMessage, SelectField, TextAreaField, TextField } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/actions";
import {
  confirmHandoverAction,
  confirmReturnAction,
  prepareHandoverAction,
  reviseHandoverAction,
  uploadEvidenceAction,
} from "@/lib/bookings/handover-actions";

const INITIAL: FormState = { status: "idle" };

const PAYMENT_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
] as const;


function Submit({ pending, children, variant = "default" }: { pending: boolean; children: React.ReactNode; variant?: "default" | "destructive" | "outline" }) {
  return (
    <Button type="submit" variant={variant} className="h-9" disabled={pending}>
      {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

export function PrepareHandoverForm({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState(prepareHandoverAction, INITIAL);
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <input type="hidden" name="bookingId" value={bookingId} />
      <FormMessage status={state.status} message={state.message} />
      <TextAreaField
        name="conditionNotes"
        fieldId={`condition-${bookingId}`}
        label="Condition of the item at handover"
        hint="Visible wear, scratches, missing parts, accessories included. Up to 1,000 characters."
        rows={4}
        maxLength={1000}
        required
        defaultValue={state.values?.conditionNotes}
        error={state.fieldErrors?.conditionNotes}
      />
      <SelectField
        name="paymentMethod"
        label="How the renter pays you (offline)"
        options={PAYMENT_OPTIONS}
        placeholder="Choose a method"
        required
        defaultValue={state.values?.paymentMethod ?? ""}
        error={state.fieldErrors?.paymentMethod}
      />
      <p className="text-xs text-muted-foreground">
        Only the method’s name is recorded. Never enter UPI IDs, account numbers or card details here.
      </p>
      <div>
        <Submit pending={pending}>Share summary with the renter</Submit>
      </div>
    </form>
  );
}

export function ConfirmHandoverForm({
  bookingId,
  exchangeId,
  revision,
  statements,
  kind = "handover",
  settlement,
}: {
  bookingId: string;
  exchangeId: string;
  revision: number;
  statements: readonly { key: string; label: string }[];
  kind?: "handover" | "return";
  /** Return only: the exact deduction and refund being confirmed (decimal strings). */
  settlement?: { deduction: string; refund: string };
}) {
  const [state, formAction, pending] = useActionState(kind === "return" ? confirmReturnAction : confirmHandoverAction, INITIAL);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const all = statements.every((s) => ticked.has(s.key));
  const error = state.fieldErrors?.ack;

  return (
    <form action={formAction} className="grid gap-3" noValidate>
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="exchangeId" value={exchangeId} />
      <input type="hidden" name="revision" value={revision} />
      {settlement ? (
        <>
          <input type="hidden" name="deduction" value={settlement.deduction} />
          <input type="hidden" name="refund" value={settlement.refund} />
        </>
      ) : null}
      <FormMessage status={state.status} message={state.message} />
      <fieldset className="grid gap-3" aria-describedby={error ? `ack-error-${exchangeId}` : undefined}>
        <legend className="mb-1 text-sm font-semibold">Tick each statement that is true</legend>
        {statements.map((s) => {
          const id = `ack-${exchangeId}-${s.key}`;
          return (
            <div key={s.key} className="flex items-start gap-3">
              <input
                id={id}
                type="checkbox"
                name="ack"
                value={s.key}
                checked={ticked.has(s.key)}
                onChange={(e) =>
                  setTicked((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(s.key);
                    else next.delete(s.key);
                    return next;
                  })
                }
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <Label htmlFor={id} className="text-sm leading-snug font-normal">
                {s.label}
              </Label>
            </div>
          );
        })}
      </fieldset>
      {error ? (
        <p id={`ack-error-${exchangeId}`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="h-9" disabled={pending || !all}>
          {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
          {kind === "return" ? "Confirm return" : "Confirm handover"}
        </Button>
        {!all ? <span className="text-xs text-muted-foreground">Tick all {statements.length} to continue.</span> : null}
      </div>
    </form>
  );
}

export function ReviseHandoverForm({
  bookingId,
  exchangeId,
  revision,
  conditionNotes,
  paymentMethod,
}: {
  bookingId: string;
  exchangeId: string;
  revision: number;
  conditionNotes: string;
  paymentMethod: string;
}) {
  const [state, formAction, pending] = useActionState(reviseHandoverAction, INITIAL);
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
      <p className="text-sm font-semibold">Correct the summary</p>
      <p className="text-sm text-muted-foreground">
        This creates a new version. Any confirmation already given stops counting, and both of you confirm the new version. Dates and
        amounts can’t be changed.
      </p>
      <FormMessage status={state.status} message={state.message} />
      <TextAreaField
        name="conditionNotes"
        fieldId={`revise-condition-${exchangeId}`}
        label="Condition of the item"
        rows={4}
        maxLength={1000}
        defaultValue={state.values?.conditionNotes ?? conditionNotes}
        error={state.fieldErrors?.conditionNotes}
      />
      <SelectField
        name="paymentMethod"
        label="Offline payment method"
        options={PAYMENT_OPTIONS}
        defaultValue={state.values?.paymentMethod ?? paymentMethod}
        error={state.fieldErrors?.paymentMethod}
      />
      <TextAreaField
        name="reason"
        fieldId={`revise-reason-${exchangeId}`}
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

export function EvidenceUploadForm({ bookingId, exchangeId }: { bookingId: string; exchangeId: string }) {
  const [state, formAction, pending] = useActionState(uploadEvidenceAction, INITIAL);
  return (
    <form action={formAction} className="grid gap-3" noValidate>
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="exchangeId" value={exchangeId} />
      <FormMessage status={state.status} message={state.message} />
      <TextField
        name="photo"
        type="file"
        label="Add a condition photo"
        accept="image/jpeg,image/png,image/webp"
        hint="JPEG, PNG or WebP, up to 5 MB. Location data is removed. Only the two of you and BorrowNest support can see it."
        error={state.fieldErrors?.photo}
        className="h-auto py-1.5"
      />
      <TextField
        name="caption"
        label="Caption (optional)"
        maxLength={200}
        defaultValue={state.values?.caption}
        error={state.fieldErrors?.caption}
      />
      <div>
        <Submit pending={pending} variant="outline">
          Upload photo
        </Submit>
      </div>
    </form>
  );
}

