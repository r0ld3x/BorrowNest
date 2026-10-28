import "server-only";

import { addDays, gwaliorToday, toRanges } from "@/lib/bookings/dates";
import { productPhotoUrl } from "@/lib/listings/queries";
import { createClient } from "@/lib/supabase/server";
import type { BookingStatus, Database } from "@/types/database";

// Booking reads go through participant-scoped database functions. Neither
// returns pickup addresses: those only exist after confirmation (Stage 7).

export const BOOKINGS_PAGE_SIZE = 20;

type RenterRow = Database["public"]["Functions"]["renter_bookings"]["Returns"][number];
type ProviderRow = Database["public"]["Functions"]["provider_booking_requests"]["Returns"][number];

export type RenterBooking = RenterRow & { coverUrl: string | null };

export async function listRenterBookings(page: number) {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("renter_bookings", {
    p_booking_id: null,
    p_limit: BOOKINGS_PAGE_SIZE,
    p_offset: (page - 1) * BOOKINGS_PAGE_SIZE,
  });
  if (error) {
    console.error("Renter bookings query failed", { code: error.code });
    return null;
  }
  const total = data[0]?.total_count ?? 0;
  return {
    rows: data.map((row): RenterBooking => ({ ...row, coverUrl: row.cover_path ? productPhotoUrl(row.cover_path) : null })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / BOOKINGS_PAGE_SIZE)),
  };
}

export async function getRenterBooking(bookingId: string) {
  const supabase = await createClient();
  if (!supabase) return null;
  const [booking, events, pickup] = await Promise.all([
    supabase.rpc("renter_bookings", { p_booking_id: bookingId, p_limit: 1, p_offset: 0 }).maybeSingle(),
    supabase.from("booking_events").select("id, event_type, next_status, created_at").eq("booking_id", bookingId).order("created_at"),
    // RLS returns the snapshot only for this renter's confirmed (or recently
    // completed) booking; pending, declined and cancelled get nothing.
    supabase.from("booking_pickup_snapshots").select("exact_address, pickup_instructions").eq("booking_id", bookingId).maybeSingle(),
  ]);
  if (booking.error || events.error || pickup.error) {
    console.error("Renter booking query failed", { code: booking.error?.code ?? events.error?.code ?? pickup.error?.code });
    return null;
  }
  if (!booking.data) return null;
  return {
    booking: { ...booking.data, coverUrl: booking.data.cover_path ? productPhotoUrl(booking.data.cover_path) : null },
    events: events.data,
    pickup: pickup.data,
  };
}

export async function listProviderRequests(status: BookingStatus | null, page: number) {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("provider_booking_requests", {
    p_status: status,
    p_booking_id: null,
    p_limit: BOOKINGS_PAGE_SIZE,
    p_offset: (page - 1) * BOOKINGS_PAGE_SIZE,
  });
  if (error) {
    console.error("Provider requests query failed", { code: error.code });
    return null;
  }
  const total = data[0]?.total_count ?? 0;
  return { rows: data as ProviderRow[], total, page, pageCount: Math.max(1, Math.ceil(total / BOOKINGS_PAGE_SIZE)) };
}

/** Reserved ranges for a public listing over the next 180 days (dates only). */
export async function getBlockedRanges(productId: string) {
  const supabase = await createClient();
  if (!supabase) return [];
  const today = gwaliorToday();
  const { data, error } = await supabase.rpc("product_blocked_dates", {
    p_product_id: productId,
    p_from: today,
    p_to: addDays(today, 180),
  });
  if (error) {
    console.error("Blocked dates query failed", { code: error.code });
    return [];
  }
  return toRanges(data.map((row) => row.blocked_date));
}
