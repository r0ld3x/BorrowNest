import { CalendarIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { BookingStatusBadge, formatDay } from "@/components/bookings/booking-parts";
import { Pagination } from "@/components/common/list-controls";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageLoading } from "@/components/layout/page-loading";
import { CatalogueImage } from "@/components/listings/catalogue-image";
import { buttonVariants } from "@/components/ui/button";
import { parsePage } from "@/lib/admin/params";
import { requireRole } from "@/lib/auth/session";
import { listRenterBookings } from "@/lib/bookings/queries";
import { formatInr } from "@/lib/utils";

export const metadata: Metadata = { title: "Your bookings" };

async function RenterBookingsPage({ searchParams }: PageProps<"/renter/bookings">) {
  const profile = await requireRole(["renter"]);
  const page = parsePage((await searchParams).page);
  const result = await listRenterBookings(page);

  return (
    <DashboardShell profile={profile} title="Your bookings">
      {result === null ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Your bookings could not be loaded. Please try again later.
        </p>
      ) : result.rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <CalendarIcon aria-hidden="true" className="size-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">No requests yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Find an item, choose your dates, and send a request to its provider.</p>
          <Link href="/listings" className={buttonVariants({ className: "mt-6 h-10 px-4" })}>
            Browse listings
          </Link>
        </div>
      ) : (
        <>
          <ul className="grid gap-3">
            {result.rows.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/renter/bookings/${b.id}`}
                  className="flex gap-4 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-muted sm:size-24">
                    <CatalogueImage src={b.coverUrl} alt="" sizes="96px" />
                  </div>
                  <div className="grid min-w-0 flex-1 content-start gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 font-semibold wrap-break-word">{b.product_title}</h2>
                      <BookingStatusBadge status={b.status} />
                      {b.no_longer_available ? (
                        <span className="rounded-full border border-amber-500/40 px-2 text-xs text-amber-900 dark:text-amber-200">No longer available</span>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatDay(b.start_date, "short")} – {formatDay(b.end_date, "short")} · {b.rental_days}{" "}
                      {b.rental_days === 1 ? "day" : "days"} · {b.product_area}
                    </p>
                    <p className="text-sm">
                      Total due at pickup <span className="font-semibold tabular-nums">{formatInr(b.total_due)}</span>
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination pathname="/renter/bookings" page={result.page} pageCount={result.pageCount} total={result.total} />
        </>
      )}
    </DashboardShell>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page(props: PageProps<"/renter/bookings">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <RenterBookingsPage {...props} />
    </Suspense>
  );
}
