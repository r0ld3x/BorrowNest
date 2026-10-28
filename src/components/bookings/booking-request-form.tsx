"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import { FormMessage, TextAreaField } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/actions";
import { requestBookingAction } from "@/lib/bookings/actions";
import { addDays, checkDates, MAX_DAYS_AHEAD, MAX_RENTAL_DAYS, overlapsRanges, quote, rentalDays, type DateProblem } from "@/lib/bookings/dates";
import { formatInr } from "@/lib/utils";

const INITIAL: FormState = { status: "idle" };

const PROBLEMS: Record<DateProblem, string> = {
  invalid: "Choose your dates and times.",
  start_too_soon: "The start date must be tomorrow or later (Gwalior time).",
  start_too_far: "Requests can start at most a year from today.",
  end_before_start: "The end date must be on or after the start date.",
  rental_too_long: `Rentals can be at most ${MAX_RENTAL_DAYS} days.`,
  return_before_pickup: "For a one-day rental, return must be after pickup.",
};

const FIELD =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30";

export function BookingRequestForm({
  productId,
  pricePerDay,
  deposit,
  today,
  blocked,
  requestKey: serverKey,
}: {
  productId: string;
  pricePerDay: number;
  deposit: number;
  /** Gwalior's date on the server, so the minimum is right in any time zone. */
  today: string;
  blocked: { start: string; end: string }[];
  /** Made on the server per page view: stable through hydration and retries. */
  requestKey: string;
}) {
  const [state, action, pending] = useActionState(requestBookingAction, INITIAL);
  const tomorrow = addDays(today, 1);
  const [start, setStart] = useState(state.values?.startDate || tomorrow);
  const [end, setEnd] = useState(state.values?.endDate || addDays(tomorrow, 2));
  const [pickupTime, setPickupTime] = useState(state.values?.pickupTime || "10:00");
  const [returnTime, setReturnTime] = useState(state.values?.returnTime || "18:00");
  // One key per form: a double click or retry can never create two requests.
  const requestKey = state.values?.requestKey || serverKey;

  const problem = checkDates({ start, end, pickupTime, returnTime, today });
  const clashes = !problem && overlapsRanges(start, end, blocked);
  const preview = useMemo(
    () => (problem ? null : quote(pricePerDay, deposit, rentalDays(start, end))),
    [problem, pricePerDay, deposit, start, end],
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="requestKey" value={requestKey} />
      <FormMessage status={state.status} message={state.message} />

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <label htmlFor="booking-start" className="text-sm font-medium">
            Start date
          </label>
          <input
            id="booking-start"
            name="startDate"
            type="date"
            min={tomorrow}
            max={addDays(today, MAX_DAYS_AHEAD)}
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (e.target.value && end < e.target.value) setEnd(e.target.value);
            }}
            aria-invalid={errors.startDate ? true : undefined}
            className={FIELD}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="booking-end" className="text-sm font-medium">
            End date
          </label>
          <input
            id="booking-end"
            name="endDate"
            type="date"
            min={start || tomorrow}
            max={start ? addDays(start, MAX_RENTAL_DAYS - 1) : undefined}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            aria-invalid={errors.endDate ? true : undefined}
            className={FIELD}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="booking-pickup" className="text-sm font-medium">
            Pickup time
          </label>
          <input id="booking-pickup" name="pickupTime" type="time" step={900} value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} aria-invalid={errors.pickupTime ? true : undefined} className={FIELD} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="booking-return" className="text-sm font-medium">
            Return time
          </label>
          <input id="booking-return" name="returnTime" type="time" step={900} value={returnTime} onChange={(e) => setReturnTime(e.target.value)} aria-invalid={errors.returnTime ? true : undefined} className={FIELD} />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">Gwalior time (IST). Both dates count as rental days.</p>

      {[errors.startDate, errors.endDate, errors.pickupTime, errors.returnTime].filter(Boolean).map((message) => (
        <p key={message} className="text-sm text-destructive">
          {message}
        </p>
      ))}
      {problem && problem !== "invalid" ? (
        <p role="status" className="text-sm text-destructive">
          {PROBLEMS[problem]}
        </p>
      ) : null}
      {clashes ? (
        <p role="status" className="text-sm text-destructive">
          Some of these dates are already booked. Choose different dates.
        </p>
      ) : null}

      {preview ? (
        <dl className="grid gap-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm" aria-live="polite">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              {formatInr(pricePerDay)} × {preview.days} {preview.days === 1 ? "day" : "days"}
            </dt>
            <dd className="tabular-nums">{formatInr(preview.rent)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Refundable deposit</dt>
            <dd className="tabular-nums">{formatInr(preview.deposit)}</dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold">
            <dt>Total due at pickup (offline)</dt>
            <dd className="tabular-nums">{formatInr(preview.total)}</dd>
          </div>
        </dl>
      ) : null}

      <TextAreaField
        name="note"
        fieldId="booking-note"
        label="Note for the provider (optional)"
        rows={2}
        maxLength={500}
        defaultValue={state.values?.note}
        error={errors.note}
      />

      <Button type="submit" size="lg" className="h-11 w-full text-base" disabled={pending || Boolean(problem) || clashes}>
        {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
        {pending ? "Sending request" : "Request to rent"}
      </Button>
      <p className="text-xs text-muted-foreground">
        This sends a request, not a booking. Nothing is reserved until the provider confirms, and no payment is taken here.
      </p>
    </form>
  );
}
