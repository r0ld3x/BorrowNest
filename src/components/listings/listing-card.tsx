import { MapPinIcon } from "lucide-react";
import Link from "next/link";

import { CatalogueImage } from "@/components/listings/catalogue-image";
import { getCategoryLabel, SERVICE_CITY } from "@/lib/constants";
import { formatInr } from "@/lib/utils";
import type { PublicListingSummary } from "@/types/listing";

interface ListingCardProps {
  listing: PublicListingSummary;
  /** Set for cards visible above the fold. */
  priority?: boolean;
  headingLevel?: "h2" | "h3";
}

export function ListingCard({ listing, priority = false, headingLevel: Heading = "h3" }: ListingCardProps) {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs transition-shadow duration-200 hover:shadow-md has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
      <div className="relative aspect-4/3 bg-muted">
        <CatalogueImage
          src={listing.coverUrl}
          alt={`Photo of ${listing.title}`}
          priority={priority}
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-primary uppercase">{getCategoryLabel(listing.category)}</p>
          <Heading className="mt-1 text-base leading-snug font-semibold wrap-break-word">
            {/* The whole card is clickable through this link's overlay. */}
            <Link href={`/listings/${listing.id}`} className="outline-none after:absolute after:inset-0">
              {listing.title}
            </Link>
          </Heading>
          <p className="mt-1.5 flex items-start gap-1 text-sm text-muted-foreground">
            <MapPinIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {listing.area}, {SERVICE_CITY}
              {listing.landmark ? <span className="block text-xs">{listing.landmark}</span> : null}
            </span>
          </p>
        </div>
        <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Daily rate</dt>
            <dd className="text-base font-semibold">
              {formatInr(listing.pricePerDay)}
              <span className="text-sm font-normal text-muted-foreground"> / day</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Refundable deposit</dt>
            <dd className="font-semibold">{formatInr(listing.deposit)}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
