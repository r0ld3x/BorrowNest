import { LogInIcon } from "lucide-react";
import Link from "next/link";
import { randomUUID } from "node:crypto";

import { BookingRequestForm } from "@/components/bookings/booking-request-form";
import { formatDay } from "@/components/bookings/booking-parts";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/session";
import { gwaliorToday } from "@/lib/bookings/dates";
import { getBlockedRanges } from "@/lib/bookings/queries";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Session-aware rent section. Renters get the request form; everyone sees
 * which dates are already confirmed (dates only, no booking details).
 */
export async function RentPanel({
  listingId,
  pricePerDay,
  deposit,
}: {
  listingId: string;
  pricePerDay: number;
  deposit: number;
}) {
  if (!isSupabaseConfigured()) return null;
  const [lookup, blocked] = await Promise.all([getCurrentProfile(), getBlockedRanges(listingId)]);

  const blockedNote =
    blocked.length > 0 ? (
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <p className="font-medium">Already booked</p>
        <ul className="mt-1 text-muted-foreground">
          {blocked.map((r) => (
            <li key={r.start}>
              {r.start === r.end ? formatDay(r.start, "short") : `${formatDay(r.start, "short")} – ${formatDay(r.end, "short")}`}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted-foreground">Other dates may still be taken by the time the provider confirms.</p>
      </div>
    ) : null;

  if (lookup.kind === "signed-out") {
    return (
      <div className="grid gap-3">
        {blockedNote}
        <Link
          href={{ pathname: "/login", query: { next: `/listings/${listingId}` } }}
          className={buttonVariants({ size: "lg", className: "h-11 w-full text-base" })}
        >
          <LogInIcon aria-hidden="true" data-icon="inline-start" />
          Log in to rent
        </Link>
        <p className="text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
            Create a renter account
          </Link>
        </p>
      </div>
    );
  }

  const isActiveRenter = lookup.kind === "found" && lookup.profile.role === "renter" && lookup.profile.accountStatus === "active";
  if (!isActiveRenter) {
    return (
      <div className="grid gap-3">
        {blockedNote}
        <p className="rounded-lg border border-border bg-muted/50 p-4 text-sm">Rentals are requested from active renter accounts.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {blockedNote}
      <BookingRequestForm
        productId={listingId}
        pricePerDay={pricePerDay}
        deposit={deposit}
        today={gwaliorToday()}
        blocked={blocked}
        requestKey={randomUUID()}
      />
    </div>
  );
}
