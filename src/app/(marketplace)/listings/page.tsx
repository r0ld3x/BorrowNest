import { PackageOpenIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ListingCard } from "@/components/listings/listing-card";
import { buttonVariants } from "@/components/ui/button";
import {
  LISTING_CATEGORIES,
  SERVICE_CITY,
  getCategoryLabel,
  parseCategoryParam,
  type ListingCategorySlug,
} from "@/lib/constants";
import { getSampleListings } from "@/lib/mock-listings";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Browse listings",
  description: `Sample rental listings from providers in ${SERVICE_CITY}.`,
};

export default function ListingsPage({ searchParams }: PageProps<"/listings">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14">
      <h1 className="text-3xl font-semibold tracking-tight">
        Browse listings in {SERVICE_CITY}
      </h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        These are sample listings that preview how the marketplace will look.
        They are not live offers, and rental requests are not open yet.
      </p>
      <Suspense fallback={<ListingsFallback />}>
        <FilteredListings searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function FilteredListings({
  searchParams,
}: Pick<PageProps<"/listings">, "searchParams">) {
  const { category: rawCategory } = await searchParams;
  // Untrusted input: only allowlisted slugs are used, the raw value is never
  // rendered or placed into a URL.
  const parsed = parseCategoryParam(rawCategory);
  const category = parsed === "invalid" ? null : parsed;
  const listings = getSampleListings(category);

  return (
    <>
      <CategoryFilter active={category} />

      {parsed === "invalid" ? (
        <p
          role="status"
          className="mt-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm"
        >
          That category is not available. Showing all sample listings.
        </p>
      ) : null}

      <p className="mt-6 text-sm text-muted-foreground">
        {listings.length} sample {listings.length === 1 ? "listing" : "listings"}
        {category ? ` in ${getCategoryLabel(category)}` : ""}
      </p>

      {listings.length > 0 ? (
        <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing, index) => (
            <li key={listing.id}>
              <ListingCard listing={listing} headingLevel="h2" priority={index < 3} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState category={category} />
      )}
    </>
  );
}

function CategoryFilter({ active }: { active: ListingCategorySlug | null }) {
  const options = [
    { slug: null, label: "All" },
    ...LISTING_CATEGORIES.map(({ slug, label }) => ({ slug, label })),
  ];

  return (
    <nav aria-label="Filter by category" className="mt-8">
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = option.slug === active;
          return (
            <li key={option.slug ?? "all"}>
              <Link
                href={
                  option.slug
                    ? { pathname: "/listings", query: { category: option.slug } }
                    : "/listings"
                }
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium transition-colors duration-150",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent",
                )}
              >
                {option.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function EmptyState({ category }: { category: ListingCategorySlug | null }) {
  return (
    <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <PackageOpenIcon aria-hidden="true" className="size-10 text-muted-foreground" />
      <h2 className="mt-4 text-lg font-semibold">No sample listings here yet</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {category
          ? `There are no sample listings in ${getCategoryLabel(category)} right now.`
          : "There are no sample listings right now."}{" "}
        Try another category.
      </p>
      <Link href="/listings" className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>
        View all sample listings
      </Link>
    </div>
  );
}

function ListingsFallback() {
  return (
    <div role="status" className="mt-8">
      <span className="sr-only">Loading listings</span>
      <div aria-hidden="true" className="flex flex-wrap gap-2">
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} className="h-9 w-24 animate-pulse rounded-full bg-muted" />
        ))}
      </div>
      <div aria-hidden="true" className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="aspect-4/3 animate-pulse bg-muted" />
            <div className="space-y-2 p-4">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
