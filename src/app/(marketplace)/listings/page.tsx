import { PackageOpenIcon, XIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Pagination } from "@/components/common/list-controls";
import { PageLoading } from "@/components/layout/page-loading";
import { CatalogueFilterForm } from "@/components/listings/catalogue-filters";
import { ListingCard } from "@/components/listings/listing-card";
import { MobileFilterSheet } from "@/components/listings/mobile-filter-sheet";
import { buttonVariants } from "@/components/ui/button";
import { CATALOGUE_SORTS, filtersToQuery, hasActiveFilters, parseCatalogueFilters, type CatalogueFilters } from "@/lib/catalogue/params";
import { getPublishedAreas, searchCatalogue } from "@/lib/catalogue/queries";
import { getCategoryLabel, LISTING_CATEGORIES, SERVICE_CITY } from "@/lib/constants";
import { formatInr } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Browse listings",
  description: `Rent furniture, appliances, bicycles and more from providers in ${SERVICE_CITY}.`,
};

/** Removable chips for each active filter; each link drops just that one. */
function activeChips(filters: CatalogueFilters) {
  const chips: { label: string; without: Partial<CatalogueFilters> }[] = [];
  if (filters.q) chips.push({ label: `“${filters.q}”`, without: { q: "" } });
  if (filters.category) chips.push({ label: getCategoryLabel(filters.category), without: { category: null } });
  if (filters.area) chips.push({ label: filters.area, without: { area: "" } });
  if (filters.min !== null) chips.push({ label: `From ${formatInr(filters.min)}`, without: { min: null } });
  if (filters.max !== null) chips.push({ label: `Up to ${formatInr(filters.max)}`, without: { max: null } });
  return chips.map((chip) => ({ label: chip.label, query: filtersToQuery({ ...filters, ...chip.without, page: 1 }) }));
}

async function ListingsPage({ searchParams }: PageProps<"/listings">) {
  const filters = parseCatalogueFilters(await searchParams);
  const [result, areas] = await Promise.all([searchCatalogue(filters), getPublishedAreas()]);
  const chips = activeChips(filters);
  const filtered = hasActiveFilters(filters);
  const sortLabel = CATALOGUE_SORTS.find((s) => s.value === filters.sort)?.label;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14">
      <h1 className="text-3xl font-semibold tracking-tight">Browse listings in {SERVICE_CITY}</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Every listing is one item from a local provider, reviewed by BorrowNest before it appears here.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="hidden lg:block" aria-label="Filters">
          <div className="sticky top-24 rounded-xl border border-border bg-card p-5">
            <CatalogueFilterForm filters={filters} areas={areas} idPrefix="desktop" />
          </div>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <MobileFilterSheet activeCount={chips.length}>
              <CatalogueFilterForm filters={filters} areas={areas} idPrefix="mobile" />
            </MobileFilterSheet>
            {chips.map((chip) => (
              <Link
                key={chip.label}
                href={{ pathname: "/listings", query: chip.query }}
                className="inline-flex h-8 max-w-full items-center gap-1 rounded-full border border-border bg-card px-3 text-sm transition-colors hover:bg-muted"
                aria-label={`Remove filter ${chip.label}`}
              >
                <span className="truncate">{chip.label}</span>
                <XIcon aria-hidden="true" className="size-3.5 shrink-0" />
              </Link>
            ))}
            {chips.length > 1 ? (
              <Link href="/listings" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                Clear all
              </Link>
            ) : null}
          </div>

          {filters.ignored ? (
            <p role="status" className="mt-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm">
              Some filter values were not valid and were ignored.
            </p>
          ) : null}

          {result === null ? (
            <p role="alert" className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Listings could not be loaded right now. Please try again in a moment.
            </p>
          ) : result.rows.length === 0 ? (
            // Past the last page the database returns no rows (and so no
            // total), so any empty page after the first is out of range.
            <EmptyState filtered={filtered} pageOutOfRange={filters.page > 1} />
          ) : (
            <>
              <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
                {result.total} {result.total === 1 ? "listing" : "listings"} · {sortLabel}
              </p>
              <ul className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {result.rows.map((listing, index) => (
                  <li key={listing.id}>
                    <ListingCard listing={listing} headingLevel="h2" priority={index < 3} />
                  </li>
                ))}
              </ul>
              <Pagination
                pathname="/listings"
                page={result.page}
                pageCount={result.pageCount}
                total={result.total}
                query={filtersToQuery({ ...filters, page: 1 })}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ filtered, pageOutOfRange }: { filtered: boolean; pageOutOfRange: boolean }) {
  return (
    <div className="mt-6 flex flex-col items-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
      <PackageOpenIcon aria-hidden="true" className="size-10 text-muted-foreground" />
      <h2 className="mt-4 text-lg font-semibold">
        {pageOutOfRange ? "No more listings on this page" : filtered ? "No listings match these filters" : "No listings yet"}
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {pageOutOfRange
          ? "Go back to the first page to see what’s available."
          : filtered
            ? "Try a broader search, another area, or a different price range."
            : `Providers in ${SERVICE_CITY} are adding items. Check back soon.`}
      </p>
      {filtered || pageOutOfRange ? (
        <>
          <Link href="/listings" className={buttonVariants({ variant: "outline", className: "mt-6 h-10 px-4" })}>
            Clear filters
          </Link>
          <ul className="mt-6 flex flex-wrap justify-center gap-2" aria-label="Browse a category instead">
            {LISTING_CATEGORIES.map((c) => (
              <li key={c.slug}>
                <Link
                  href={{ pathname: "/listings", query: { category: c.slug } }}
                  className="inline-flex h-8 items-center rounded-full border border-border px-3 text-sm hover:bg-muted"
                >
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page(props: PageProps<"/listings">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ListingsPage {...props} />
    </Suspense>
  );
}
