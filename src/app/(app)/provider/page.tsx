import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DashboardShell, UpcomingPanel } from "@/components/dashboard/dashboard-shell";
import { PageLoading } from "@/components/layout/page-loading";
import { ListingStatusBadge } from "@/components/listings/provider/listing-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/session";
import { getOwnListings } from "@/lib/listings/queries";

export const metadata: Metadata = { title: "Provider dashboard" };

async function ProviderDashboardPage() {
  const profile = await requireRole(["provider"], "/provider");
  // RLS returns only this provider's own listings.
  const listings = await getOwnListings();
  const recent = listings?.slice(0, 5) ?? [];

  return (
    <DashboardShell profile={profile} title="Provider overview">
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="listings-heading" className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id="listings-heading" className="font-semibold">
              Recent listings
            </h2>
            <Link href="/provider/listings/new" className={buttonVariants({ size: "sm", className: "h-8" })}>
              <PlusIcon aria-hidden="true" data-icon="inline-start" />
              New listing
            </Link>
          </div>
          {listings === null ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              Your listings could not be loaded. Please try again later.
            </p>
          ) : recent.length > 0 ? (
            <>
              <ul className="mt-3 divide-y divide-border text-sm">
                {recent.map((listing) => (
                  <li key={listing.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link
                      href={`/provider/listings/${listing.id}`}
                      className="min-w-0 wrap-break-word underline-offset-4 hover:underline"
                    >
                      {listing.title}
                    </Link>
                    <ListingStatusBadge status={listing.status} />
                  </li>
                ))}
              </ul>
              <Link
                href="/provider/listings"
                className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                View all listings
              </Link>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              You have no listings yet. Create a draft to get started.
            </p>
          )}
        </section>
        {/* <UpcomingPanel
          title="Coming in later stages"
          items={[
            "Admin approval makes submitted listings public.",
            "Accept or decline rental requests for your items.",
            "Confirm handover and return together with the renter.",
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
      <ProviderDashboardPage />
    </Suspense>
  );
}
