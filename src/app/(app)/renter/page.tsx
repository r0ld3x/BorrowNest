import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { BookingStatusBadge, formatDay } from "@/components/bookings/booking-parts";
import { DashboardShell, UpcomingPanel } from "@/components/dashboard/dashboard-shell";
import { PageLoading } from "@/components/layout/page-loading";
import { buttonVariants } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/session";
import { listRenterBookings } from "@/lib/bookings/queries";

export const metadata: Metadata = { title: "Renter dashboard" };

async function RenterDashboardPage() {
  const profile = await requireRole(["renter"], "/renter");
  const bookings = await listRenterBookings(1);
  const recent = bookings?.rows.slice(0, 5) ?? [];

  return (
    <DashboardShell profile={profile} title="Your rentals">
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="recent-heading" className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id="recent-heading" className="font-semibold">
              Recent requests
            </h2>
            {recent.length > 0 ? (
              <Link href="/renter/bookings" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                View all
              </Link>
            ) : null}
          </div>
          {bookings === null ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              Your requests could not be loaded. Please try again later.
            </p>
          ) : recent.length > 0 ? (
            <ul className="mt-3 divide-y divide-border text-sm">
              {recent.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/renter/bookings/${b.id}`} className="min-w-0 wrap-break-word underline-offset-4 hover:underline">
                    {b.product_title}
                    <span className="block text-xs text-muted-foreground">
                      {formatDay(b.start_date, "short")} – {formatDay(b.end_date, "short")}
                    </span>
                  </Link>
                  <BookingStatusBadge status={b.status} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-2 grid gap-4">
              <p className="text-sm text-muted-foreground">You haven’t requested anything yet.</p>
              <Link href="/listings" className={buttonVariants({ className: "h-10 w-fit px-4" })}>
                Browse listings
              </Link>
            </div>
          )}
        </section>
        {/* <UpcomingPanel
          title="Coming in later stages"
          items={[
            "See whether the provider accepts or declines your request.",
            "Get the pickup address once a booking is confirmed.",
            "Confirm handover and return together with the provider.",
          ]}
        /> */}
      </div>
    </DashboardShell>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <RenterDashboardPage />
    </Suspense>
  );
}
