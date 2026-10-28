import { ArrowLeftIcon, MapPinIcon, ShieldCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageLoading } from "@/components/layout/page-loading";
import { ListingGallery } from "@/components/listings/listing-gallery";
import { RentPanel } from "@/components/listings/rent-panel";
import { getPublicListing } from "@/lib/catalogue/queries";
import { getCategoryLabel } from "@/lib/constants";
import { labelFor, PRODUCT_CONDITIONS } from "@/lib/listings/options";
import { formatInr } from "@/lib/utils";
import { uuidSchema } from "@/lib/validation/listing";

// Missing, unpublished, and suspended-provider listings all give the same
// not-found page, so ids cannot be probed.
async function loadListing(id: string) {
  const parsed = uuidSchema.safeParse(id);
  return parsed.success ? getPublicListing(parsed.data) : null;
}

export async function generateMetadata({ params }: PageProps<"/listings/[id]">): Promise<Metadata> {
  const listing = await loadListing((await params).id);
  if (!listing) return { title: "Listing not found" };
  // Public fields only: never the pickup address.
  return {
    title: listing.title,
    description: `${formatInr(listing.pricePerDay)} per day in ${listing.area}, Gwalior. ${getCategoryLabel(listing.category)}.`,
  };
}

async function ListingDetailPage({ params }: PageProps<"/listings/[id]">) {
  const listing = await loadListing((await params).id);
  if (!listing) notFound();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 md:py-12">
      <Link href="/listings" className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        All listings
      </Link>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="grid gap-8">
          <ListingGallery title={listing.title} images={listing.images} />

          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="text-lg font-semibold">
              About this item
            </h2>
            <p className="mt-2 whitespace-pre-line text-muted-foreground wrap-break-word">{listing.description}</p>
            <dl className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[9rem_1fr]">
              <dt className="text-muted-foreground">Category</dt>
              <dd>{getCategoryLabel(listing.category)}</dd>
              <dt className="text-muted-foreground">Condition</dt>
              <dd>{labelFor(PRODUCT_CONDITIONS, listing.condition)}</dd>
              <dt className="text-muted-foreground">Pickup</dt>
              <dd>Pickup only, in Gwalior. Delivery isn’t available yet.</dd>
            </dl>
          </section>
        </div>

        <aside aria-labelledby="listing-title" className="grid gap-5 lg:sticky lg:top-24">
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="text-xs font-medium tracking-wide text-primary uppercase">{getCategoryLabel(listing.category)}</p>
            <h1 id="listing-title" className="mt-1 text-2xl font-semibold tracking-tight wrap-break-word">
              {listing.title}
            </h1>
            <p className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPinIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {listing.area}, {listing.city}
                {listing.landmark ? <span className="block">{listing.landmark}</span> : null}
              </span>
            </p>
            {listing.listedBy ? <p className="mt-1 text-sm text-muted-foreground">Listed by {listing.listedBy}</p> : null}

            <dl className="mt-5 grid gap-3 border-t border-border pt-5">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-muted-foreground">Daily rate</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {formatInr(listing.pricePerDay)}
                  <span className="text-sm font-normal text-muted-foreground"> / day</span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-muted-foreground">Refundable deposit</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatInr(listing.deposit)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              The deposit is paid at pickup and returned when the item comes back as agreed. Payments are made offline.
            </p>

            <div className="mt-5">
              <Suspense fallback={<div aria-hidden="true" className="h-11 animate-pulse rounded-lg bg-muted" />}>
                <RentPanel listingId={listing.id} pricePerDay={listing.pricePerDay} deposit={listing.deposit} />
              </Suspense>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <p>
              The exact pickup address is shared only after the provider confirms a booking. Until then, listings show the
              area and a nearby landmark.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page(props: PageProps<"/listings/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ListingDetailPage {...props} />
    </Suspense>
  );
}
