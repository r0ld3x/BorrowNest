"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useState } from "react";

import { FormMessage, TextAreaField } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/actions";
import { transitionBookingAction } from "@/lib/bookings/actions";

const INITIAL: FormState = { status: "idle" };

const COPY = {
  confirm: {
    open: "Confirm…",
    title: "Confirm this request?",
    body: "These dates are reserved for this renter, and your pickup address and instructions are shared with them. The price stays as quoted.",
    submit: "Confirm and reserve",
    reasonLabel: null,
  },
  reject: {
    open: "Decline…",
    title: "Decline this request?",
    body: "The renter is told it was declined. The dates stay open for other requests.",
    submit: "Decline request",
    reasonLabel: "Reason for the renter (optional)",
  },
  cancel: {
    open: "Cancel request…",
    title: "Cancel this request?",
    body: "The provider will no longer see it as pending. This can’t be undone; you can send a new request later.",
    submit: "Cancel request",
    reasonLabel: "Reason (optional)",
  },
} as const;

type Action = keyof typeof COPY;

export function BookingDecisionControls({
  bookingId,
  actions,
  confirmBlockedReason,
}: {
  bookingId: string;
  actions: readonly Action[];
  /** When set, confirming is unavailable and this explains why. */
  confirmBlockedReason?: string | null;
}) {
  const [state, formAction, pending] = useActionState(transitionBookingAction, INITIAL);
  const [open, setOpen] = useState<Action | null>(null);

  return (
    <div className="grid gap-3">
      <FormMessage status={state.status} message={state.message} />
      {open === null ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action}
              type="button"
              variant={action === "confirm" ? "default" : "outline"}
              className="h-9"
              disabled={action === "confirm" && Boolean(confirmBlockedReason)}
              onClick={() => setOpen(action)}
            >
              {COPY[action].open}
            </Button>
          ))}
        </div>
      ) : (
        <form action={formAction} className="grid gap-3 rounded-lg border border-border bg-muted/40 p-4" noValidate>
          <input type="hidden" name="bookingId" value={bookingId} />
          <input type="hidden" name="action" value={open} />
          <p className="text-sm font-semibold">{COPY[open].title}</p>
          <p className="text-sm text-muted-foreground">{COPY[open].body}</p>
          {COPY[open].reasonLabel ? (
            <TextAreaField
              name="reason"
              fieldId={`reason-${open}-${bookingId}`}
              label={COPY[open].reasonLabel}
              rows={2}
              maxLength={500}
              defaultValue={state.values?.reason}
              error={state.fieldErrors?.reason}
            />
          ) : (
            <input type="hidden" name="reason" value="" />
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant={open === "confirm" ? "default" : "destructive"} className="h-9" disabled={pending}>
              {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
              {COPY[open].submit}
            </Button>
            <Button type="button" variant="ghost" className="h-9" disabled={pending} onClick={() => setOpen(null)}>
              Back
            </Button>
          </div>
        </form>
      )}
      {confirmBlockedReason && actions.includes("confirm") ? (
        <p className="text-sm text-muted-foreground">{confirmBlockedReason}</p>
      ) : null}
    </div>
  );
}
