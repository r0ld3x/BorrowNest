import { MapPinIcon } from "lucide-react";
import Image from "next/image";

import { getCategoryLabel } from "@/lib/constants";
import { formatInr } from "@/lib/utils";
import type { Listing } from "@/types/listing";

interface ListingCardProps {
  listing: Listing;
  /** Set for cards visible above the fold. */
  priority?: boolean;
  headingLevel?: "h2" | "h3";
}

export function ListingCard({
  listing,
  priority = false,
  headingLevel: Heading = "h3",
}: ListingCardProps) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs transition-shadow duration-200 hover:shadow-md">
      <div className="relative aspect-4/3 bg-muted">
        <Image
          src={listing.coverImage.src}
          alt={listing.coverImage.alt}
          fill
          priority={priority}
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover"
        />
        <span className="absolute top-3 left-3 rounded-full bg-background/90 px-2.5 py-0.5 text-xs font-medium text-foreground shadow-xs">
          Sample listing
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-primary uppercase">
            {getCategoryLabel(listing.category)}
          </p>
          <Heading className="mt-1 text-base leading-snug font-semibold">
            {listing.title}
          </Heading>
          <p className="mt-1.5 flex items-start gap-1 text-sm text-muted-foreground">
            <MapPinIcon
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
            <span>
              {listing.area}, {listing.city}
              <span className="block text-xs">{listing.landmark}</span>
            </span>
          </p>
        </div>
        <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Daily rate</dt>
            <dd className="font-semibold">
              {formatInr(listing.dailyRate)}
              <span className="font-normal text-muted-foreground"> / day</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              Refundable deposit
            </dt>
            <dd className="font-semibold">
              {formatInr(listing.refundableDeposit)}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
