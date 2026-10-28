import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { FormMessage } from "@/components/auth/form-parts";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageLoading } from "@/components/layout/page-loading";
import { ListingForm } from "@/components/listings/provider/listing-form";
import { ListingStatusActions } from "@/components/listings/provider/listing-status-actions";
import { ListingStatusBadge } from "@/components/listings/provider/listing-status-badge";
import { PhotoManager } from "@/components/listings/provider/photo-manager";
import { requireRole } from "@/lib/auth/session";
import { getOwnListing } from "@/lib/listings/queries";
import { uuidSchema } from "@/lib/validation/listing";
import type { ListingStatus } from "@/types/database";

export const metadata: Metadata = { title: "Edit listing" };

const STATUS_HELP: Record<ListingStatus, string> = {
  draft: "Only you can see this draft. Submit it when the details and photos are ready.",
  pending_review: "An admin is reviewing this listing. You can still edit it while you wait.",
  published: "Renters can see this listing. Editing it sends it back for review.",
  paused: "Hidden from renters. Resume to show it again, or edit it to send it for review.",
  rejected: "An admin asked for changes. Update the listing, then submit it again.",
  archived: "Hidden and read-only. Its history is kept.",
};

async function EditListingPage({ params, searchParams }: PageProps<"/provider/listings/[id]">) {
  const profile = await requireRole(["provider"]);
  const [{ id }, { created }] = await Promise.all([params, searchParams]);

  const productId = uuidSchema.safeParse(id);
  if (!productId.success) notFound();

  // RLS returns the row only to its owner (or an admin, who is not here).
  const listing = await getOwnListing(productId.data);
  if (!listing) notFound();

  const archived = listing.status === "archived";

  return (
    <DashboardShell profile={profile} title="Edit listing">
      <Link
        href="/provider/listings"
        className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        All listings
      </Link>

      {created === "1" ? (
        <div className="mb-6">
          <FormMessage status="success" message="Draft created. Add photos, then submit it for review." />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <section aria-labelledby="details-heading" className="order-2 rounded-xl border border-border bg-card p-6 sm:p-8 lg:order-1">
          <h2 id="details-heading" className="sr-only">
            Listing details
          </h2>
          <ListingForm
            productId={listing.id}
            disabled={archived}
            initialValues={{
              title: listing.title,
              description: listing.description,
              category: listing.category,
              condition: listing.condition,
              pricePerDay: listing.pricePerDay,
              deposit: listing.deposit,
              area: listing.area,
              landmark: listing.landmark,
              exactAddress: listing.exactAddress,
              pickupInstructions: listing.pickupInstructions,
            }}
          />
        </section>

        <div className="order-1 grid gap-6 lg:sticky lg:top-24 lg:order-2">
          <section aria-labelledby="status-heading" className="grid gap-3 rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 id="status-heading" className="font-semibold">
                Status
              </h2>
              <ListingStatusBadge status={listing.status} />
            </div>
            <p className="text-sm text-muted-foreground">{STATUS_HELP[listing.status]}</p>
            {listing.moderationReason ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="font-medium">Reason from the admin</p>
                <p className="mt-1 wrap-break-word whitespace-pre-line text-muted-foreground">{listing.moderationReason}</p>
              </div>
            ) : null}
            <ListingStatusActions productId={listing.id} status={listing.status} />
          </section>

          <section aria-labelledby="photos-heading" className="grid gap-3 rounded-xl border border-border bg-card p-6">
            <h2 id="photos-heading" className="font-semibold">
              Photos
            </h2>
            <PhotoManager
              productId={listing.id}
              readOnly={archived}
              photos={listing.images.map((image) => ({ id: image.id, url: image.url, caption: image.caption }))}
            />
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page(props: PageProps<"/provider/listings/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <EditListingPage {...props} />
    </Suspense>
  );
}
