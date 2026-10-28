"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useState } from "react";

import { FormMessage, SelectField, TextAreaField, TextField } from "@/components/auth/form-parts";
import { CATEGORY_OPTIONS } from "@/components/disputes/labels";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/actions";
import {
  addDisputeMessageAction,
  adminOpenDisputeForAction,
  adminReleaseInventoryHoldAction,
  adminResolveDisputeAction,
  adminSetDisputeStatusAction,
  openDisputeAction,
  uploadDisputeEvidenceAction,
} from "@/lib/bookings/handover-actions";

const INITIAL: FormState = { status: "idle" };

function Submit({ pending, children, variant = "default" }: { pending: boolean; children: React.ReactNode; variant?: "default" | "destructive" | "outline" }) {
  return (
    <Button type="submit" variant={variant} className="h-9" disabled={pending}>
      {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

export function OpenDisputeForm({ bookingId, holds }: { bookingId: string; holds: boolean }) {
  const [state, formAction, pending] = useActionState(openDisputeAction, INITIAL);
  const [open, setOpen] = useState(false);
  if (!open && state.status !== "error") {
    return (
      <Button type="button" variant="outline" className="h-9 justify-self-start" onClick={() => setOpen(true)}>
        Open a dispute…
      </Button>
    );
  }
  return (
    <form action={formAction} className="grid gap-4 rounded-lg border border-border bg-muted/40 p-4" noValidate>
      <input type="hidden" name="bookingId" value={bookingId} />
      <p className="text-sm font-semibold">Open a dispute</p>
      <p className="text-sm text-muted-foreground">
        {holds
          ? "This puts the booking on hold: neither of you can confirm the handover or return until BorrowNest support resolves it."
          : "The booking is already complete, so this is recorded as a support case. It doesn’t reopen the booking."}{" "}
        Only the other participant and BorrowNest support can see it. You can add photos and statements after opening it.
      </p>
      <FormMessage status={state.status} message={state.message} />
      <SelectField
        name="category"
        label="What is it about?"
        options={CATEGORY_OPTIONS}
        placeholder="Choose one"
        defaultValue={state.values?.category ?? ""}
        error={state.fieldErrors?.category}
      />
      <TextAreaField
        name="description"
        fieldId={`dispute-${bookingId}`}
        label="What happened"
        hint="Facts only: what, when, and what you’d like to happen. Don’t include phone numbers or bank details."
        rows={4}
        maxLength={1000}
        defaultValue={state.values?.description}
        error={state.fieldErrors?.description}
      />
      <div className="flex flex-wrap gap-2">
        <Submit pending={pending} variant="destructive">
          Open dispute
        </Submit>
        <Button type="button" variant="ghost" className="h-9" disabled={pending} onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </form>
  );
}

export function DisputeMessageForm({ bookingId, disputeId }: { bookingId: string; disputeId: string }) {
  const [state, formAction, pending] = useActionState(addDisputeMessageAction, INITIAL);
  return (
    <form action={formAction} className="grid gap-3" noValidate>
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="disputeId" value={disputeId} />
      <FormMessage status={state.status} message={state.message} />
      <TextAreaField
        name="body"
        fieldId={`message-${disputeId}`}
        label="Add your statement"
        hint="Statements can’t be edited or deleted once sent."
        rows={3}
        maxLength={2000}
        defaultValue={state.values?.body}
        error={state.fieldErrors?.body}
      />
      <div>
        <Submit pending={pending} variant="outline">
          Send statement
        </Submit>
      </div>
    </form>
  );
}

export function DisputeEvidenceForm({ bookingId, disputeId }: { bookingId: string; disputeId: string }) {
  const [state, formAction, pending] = useActionState(uploadDisputeEvidenceAction, INITIAL);
  return (
    <form action={formAction} className="grid gap-3" noValidate>
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="disputeId" value={disputeId} />
      <FormMessage status={state.status} message={state.message} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="photo"
          type="file"
          label="Add a photo"
          accept="image/jpeg,image/png,image/webp"
          hint="JPEG, PNG or WebP up to 5 MB. Location data is removed."
          error={state.fieldErrors?.photo}
          className="h-auto py-1.5"
        />
        <TextField name="caption" label="Caption (optional)" maxLength={200} defaultValue={state.values?.caption} error={state.fieldErrors?.caption} />
      </div>
      <div>
        <Submit pending={pending} variant="outline">
          Upload photo
        </Submit>
      </div>
    </form>
  );
}

// --- Admin -------------------------------------------------------------------------

export function DisputeStatusForm({ disputeId }: { disputeId: string }) {
  const [state, formAction, pending] = useActionState(adminSetDisputeStatusAction, INITIAL);
  return (
    <form action={formAction} className="grid gap-3" noValidate>
      <input type="hidden" name="disputeId" value={disputeId} />
      <FormMessage status={state.status} message={state.message} />
      <SelectField
        name="status"
        label="Status"
        options={[
          { value: "in_review", label: "In review" },
          { value: "needs_info", label: "Ask the participants for information" },
        ]}
        defaultValue="in_review"
      />
      <TextAreaField
        name="note"
        fieldId={`status-note-${disputeId}`}
        label="Note shown to both participants"
        hint="Required when asking for information. Shown in the app only; nothing is emailed."
        rows={2}
        maxLength={2000}
        defaultValue={state.values?.note}
        error={state.fieldErrors?.note}
      />
      <div>
        <Submit pending={pending} variant="outline">
          Update status
        </Submit>
      </div>
    </form>
  );
}

const DECISIONS = [
  { value: "no_action", label: "No change needed" },
  { value: "renter_favoured", label: "Decide for the renter" },
  { value: "provider_favoured", label: "Decide for the provider" },
  { value: "shared", label: "Shared responsibility" },
  { value: "admin_closure", label: "Close the booking (admin closure)" },
] as const;

const POSSESSION = [
  { value: "not_applicable", label: "Not applicable (never handed over, or already returned)" },
  { value: "with_renter", label: "Still with the renter" },
  { value: "returned_to_provider", label: "Back with the provider" },
  { value: "lost", label: "Lost" },
  { value: "damaged", label: "Damaged" },
] as const;

export function ResolveDisputeForm({ disputeId, possessionRequired }: { disputeId: string; possessionRequired: boolean }) {
  const [state, formAction, pending] = useActionState(adminResolveDisputeAction, INITIAL);
  const [decision, setDecision] = useState(state.values?.decision ?? "");
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <input type="hidden" name="disputeId" value={disputeId} />
      <FormMessage status={state.status} message={state.message} />
      <SelectField
        name="decision"
        label="Decision"
        options={DECISIONS}
        placeholder="Choose a decision"
        // Uncontrolled so React's post-action form reset restores the submitted choice.
        defaultValue={state.values?.decision ?? ""}
        onChange={(e) => setDecision(e.target.value)}
        error={state.fieldErrors?.decision}
      />
      {decision === "admin_closure" ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          Closing ends the booking as “Closed by support”, separate from a mutual completion. The dates stay reserved. Amounts below are
          recorded as still owed; closing does not pay or refund anything. A lost or damaged item’s listing is paused until you release it.
        </p>
      ) : null}
      <TextAreaField
        name="reason"
        fieldId={`resolve-reason-${disputeId}`}
        label="Reason (shown to both participants)"
        rows={3}
        maxLength={1000}
        defaultValue={state.values?.reason}
        error={state.fieldErrors?.reason}
      />
      <TextAreaField
        name="facts"
        fieldId={`resolve-facts-${disputeId}`}
        label="Facts you relied on (optional)"
        rows={2}
        maxLength={2000}
        defaultValue={state.values?.facts}
        error={state.fieldErrors?.facts}
      />
      <SelectField
        name="possession"
        label={possessionRequired ? "Where is the item now?" : "Where is the item? (optional context)"}
        options={POSSESSION}
        defaultValue={state.values?.possession ?? (possessionRequired ? "" : "not_applicable")}
        placeholder="Choose one"
        error={state.fieldErrors?.possession}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="providerOwesRenter"
          label="Provider still owes renter (₹)"
          inputMode="decimal"
          defaultValue={state.values?.providerOwesRenter ?? "0"}
          error={state.fieldErrors?.providerOwesRenter}
        />
        <TextField
          name="renterOwesProvider"
          label="Renter still owes provider (₹)"
          inputMode="decimal"
          defaultValue={state.values?.renterOwesProvider ?? "0"}
          error={state.fieldErrors?.renterOwesProvider}
        />
      </div>
      <TextField
        name="obligationNote"
        label="How the money should be settled (optional)"
        maxLength={500}
        defaultValue={state.values?.obligationNote}
        error={state.fieldErrors?.obligationNote}
      />
      <div>
        <Submit pending={pending}>{decision === "admin_closure" ? "Resolve and close booking" : "Record resolution"}</Submit>
      </div>
    </form>
  );
}

export function OpenDisputeForParticipantForm({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState(adminOpenDisputeForAction, INITIAL);
  const [open, setOpen] = useState(false);
  if (!open && state.status !== "error") {
    return (
      <Button type="button" variant="outline" className="h-9 justify-self-start" onClick={() => setOpen(true)}>
        Open a dispute on a participant’s behalf…
      </Button>
    );
  }
  return (
    <form action={formAction} className="grid gap-4 rounded-lg border border-border bg-muted/40 p-4" noValidate>
      <input type="hidden" name="bookingId" value={bookingId} />
      <p className="text-sm text-muted-foreground">
        For a participant who can’t use the app (for example a suspended account). It’s recorded as opened by support, and it never
        confirms anything for them.
      </p>
      <FormMessage status={state.status} message={state.message} />
      <SelectField
        name="onBehalf"
        label="Reported by"
        options={[
          { value: "renter", label: "The renter" },
          { value: "provider", label: "The provider" },
        ]}
        placeholder="Choose one"
        defaultValue={state.values?.onBehalf ?? ""}
        error={state.fieldErrors?.onBehalf}
      />
      <SelectField
        name="category"
        label="What is it about?"
        options={CATEGORY_OPTIONS}
        placeholder="Choose one"
        defaultValue={state.values?.category ?? ""}
        error={state.fieldErrors?.category}
      />
      <TextAreaField
        name="description"
        fieldId={`behalf-${bookingId}`}
        label="What they reported"
        rows={3}
        maxLength={1000}
        defaultValue={state.values?.description}
        error={state.fieldErrors?.description}
      />
      <div className="flex flex-wrap gap-2">
        <Submit pending={pending}>Open dispute</Submit>
        <Button type="button" variant="ghost" className="h-9" disabled={pending} onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </form>
  );
}

export function ReleaseInventoryForm({ disputeId, productId }: { disputeId: string; productId: string }) {
  const [state, formAction, pending] = useActionState(adminReleaseInventoryHoldAction, INITIAL);
  return (
    <form action={formAction} className="grid gap-3" noValidate>
      <input type="hidden" name="disputeId" value={disputeId} />
      <input type="hidden" name="productId" value={productId} />
      <FormMessage status={state.status} message={state.message} />
      <TextAreaField
        name="reason"
        fieldId={`release-${productId}`}
        label="Why the item can be listed again"
        rows={2}
        maxLength={500}
        defaultValue={state.values?.reason}
        error={state.fieldErrors?.reason}
      />
      <div>
        <Submit pending={pending} variant="outline">
          Release inventory hold
        </Submit>
      </div>
    </form>
  );
}
