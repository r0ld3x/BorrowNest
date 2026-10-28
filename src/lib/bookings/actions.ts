"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/lib/auth/actions";
import { requireRole } from "@/lib/auth/session";
import { gwaliorTimestamp } from "@/lib/bookings/dates";
import { createClient } from "@/lib/supabase/server";
import { formFields, toFieldErrors } from "@/lib/validation/auth";
import { BOOKING_REQUEST_FIELDS, bookingRequestSchema } from "@/lib/validation/booking";

const MESSAGES: Record<string, string | [field: string, message: string]> = {
  not_active_renter: "Only active renter accounts can request rentals.",
  listing_unavailable: "This listing isn’t available for rent right now.",
  dates_unavailable: ["startDate", "Those dates overlap a confirmed booking. Choose different dates."],
  start_too_soon: ["startDate", "The start date must be tomorrow or later (Gwalior time)."],
  start_too_far: ["startDate", "Requests can start at most a year from today."],
  end_before_start: ["endDate", "The end date must be on or after the start date."],
  rental_too_long: ["endDate", "Rentals can be at most 180 days."],
  pickup_not_on_start: ["pickupTime", "Pickup must be on the start date."],
  return_not_on_end: ["returnTime", "Return must be on the end date."],
  return_before_pickup: ["returnTime", "For a one-day rental, return must be after pickup."],
  invalid_dates: ["startDate", "Choose your dates and times."],
  invalid_note: ["note", "Keep the note to 500 characters or fewer."],
  request_key_conflict: "This form was already used for a different request. Reload the page and try again.",
  too_many_requests: "You have 20 open requests. Wait for providers to respond before sending more.",
  invalid_request: "Something went wrong. Reload the page and try again.",
};

export async function requestBookingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["renter"]);
  const fields = formFields(formData, BOOKING_REQUEST_FIELDS);
  const values = { ...fields, requestKey: fields.requestKey };

  const parsed = bookingRequestSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", message: "Check the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values };
  }

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now.", values };

  // Only what the renter chose. Prices, participants and status come from
  // the database; the browser preview is never trusted.
  const { data: bookingId, error } = await supabase.rpc("create_booking", {
    p_product_id: parsed.data.productId,
    p_start_date: parsed.data.startDate,
    p_end_date: parsed.data.endDate,
    p_pickup_at: gwaliorTimestamp(parsed.data.startDate, parsed.data.pickupTime),
    p_return_at: gwaliorTimestamp(parsed.data.endDate, parsed.data.returnTime),
    p_note: parsed.data.note,
    p_request_key: parsed.data.requestKey,
  });

  if (error || !bookingId) {
    const code = error?.message?.match(/BN:([a-z_]+)/)?.[1];
    console.error("Booking request failed", { code: error?.code, bnCode: code });
    const mapped = code ? MESSAGES[code] : undefined;
    if (Array.isArray(mapped)) {
      return { status: "error", message: "Check the highlighted fields.", fieldErrors: { [mapped[0]]: mapped[1] }, values };
    }
    return { status: "error", message: mapped ?? "The request could not be sent. Please try again.", values };
  }

  redirect(`/renter/bookings/${bookingId}?created=1`);
}

const TRANSITION_MESSAGES: Record<string, string> = {
  booking_not_found: "That request could not be found.",
  booking_not_pending: "This request was already decided or cancelled. Reload to see its current status.",
  dates_unavailable: "Those dates were just reserved by another confirmed booking, so this request can’t be confirmed.",
  pickup_expired: "The requested pickup time has passed, so this request can no longer be confirmed.",
  listing_unavailable: "This listing isn’t published right now, so the request can’t be confirmed.",
  renter_inactive: "The renter’s account is not active, so the request can’t be confirmed.",
  missing_pickup_details: "Add a pickup address to the listing before confirming.",
  not_active_provider: "Only active provider accounts can respond to requests.",
  not_active_renter: "Only active renter accounts can cancel requests.",
  reason_too_long: "Keep the reason to 500 characters or fewer.",
};

const transitionSchema = z.object({
  bookingId: z.uuid({ version: "v4" }),
  action: z.enum(["confirm", "reject", "cancel"]),
  reason: z
    .string()
    .transform((v) => v.replace(/\r\n?/g, "\n").replace(/[\u0001-\u0009\u000B-\u001F\u007F]/g, "").trim())
    .pipe(z.string().max(500, "Keep the reason to 500 characters or fewer.")),
});

/** Provider confirm/decline, or renter cancel. The database decides who may act. */
export async function transitionBookingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const fields = formFields(formData, ["bookingId", "action", "reason"]);
  const parsed = transitionSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: { reason: fields.reason } };
  }
  const { bookingId, action, reason } = parsed.data;
  await requireRole(action === "cancel" ? ["renter"] : ["provider"]);

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now." };

  const { data: status, error } = await supabase.rpc("transition_booking", {
    p_booking_id: bookingId,
    p_action: action,
    p_reason: reason,
  });
  if (error || !status) {
    const code = error?.message?.match(/BN:([a-z_]+)/)?.[1];
    console.error("Booking transition failed", { code: error?.code, bnCode: code });
    return {
      status: "error",
      message: (code && TRANSITION_MESSAGES[code]) || "That didn’t work. Please reload and try again.",
      values: { reason: fields.reason },
    };
  }

  // Back to the page with a fixed notice; the page re-reads the database.
  if (action === "cancel") redirect(`/renter/bookings/${bookingId}?notice=cancelled`);
  redirect(`/provider/requests?status=${status}&notice=${action === "confirm" ? "confirmed" : "declined"}`);
}
