import { ImageIcon, PackageOpenIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageLoading } from "@/components/layout/page-loading";
import { ListingStatusBadge } from "@/components/listings/provider/listing-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/session";
import { getOwnListings } from "@/lib/listings/queries";
import { formatInr } from "@/lib/utils";

export const metadata: Metadata = { title: "Your listings" };

async function ProviderListingsPage() {
  const profile = await requireRole(["provider"]);
  const listings = await getOwnListings();

  return (
    <DashboardShell profile={profile} title="Your listings">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Only you and BorrowNest admins can see drafts. Listings go public only after an admin approves them.
        </p>
        <Link href="/provider/listings/new" className={buttonVariants({ className: "h-10 px-4" })}>
          <PlusIcon aria-hidden="true" data-icon="inline-start" />
          New listing
        </Link>
      </div>

      {listings === null ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Your listings could not be loaded. Please try again later.
        </p>
      ) : listings.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <PackageOpenIcon aria-hidden="true" className="size-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">No listings yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Create a draft, add photos and a pickup location, then submit it for review.
          </p>
          <Link href="/provider/listings/new" className={buttonVariants({ className: "mt-6 h-10 px-4" })}>
            Create your first listing
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <li key={listing.id}>
              <Link
                href={`/provider/listings/${listing.id}`}
                className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow duration-200 hover:shadow-md"
              >
                <div className="relative aspect-4/3 bg-muted">
                  {listing.coverUrl ? (
                    <Image src={listing.coverUrl} alt="" fill sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <ImageIcon aria-hidden="true" className="size-8" />
                      <span className="sr-only">No photo yet</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="min-w-0 font-semibold wrap-break-word">{listing.title}</h2>
                    <ListingStatusBadge status={listing.status} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {listing.area} · {formatInr(listing.pricePerDay)} / day
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardShell>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ProviderListingsPage />
    </Suspense>
  );
}
