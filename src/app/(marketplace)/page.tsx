import {
  ArrowRightIcon,
  BikeIcon,
  BookOpenIcon,
  CookingPotIcon,
  LampIcon,
  RefrigeratorIcon,
  SofaIcon,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { PageLoading } from "@/components/layout/page-loading";
import { ListingCard } from "@/components/listings/listing-card";
import { buttonVariants } from "@/components/ui/button";
import {
  LISTING_CATEGORIES,
  SERVICE_CITY,
  type ListingCategorySlug,
} from "@/lib/constants";
import { parseCatalogueFilters } from "@/lib/catalogue/params";
import { searchCatalogue } from "@/lib/catalogue/queries";

const CATEGORY_ICONS: Record<ListingCategorySlug, LucideIcon> = {
  furniture: SofaIcon,
  appliances: RefrigeratorIcon,
  bicycles: BikeIcon,
  study_essentials: BookOpenIcon,
  kitchen: CookingPotIcon,
  other: LampIcon,
};

const HOW_IT_WORKS_STEPS = [
  {
    title: "Browse local listings",
    body: `Find items offered by providers in ${SERVICE_CITY}. Each listing is one physical item with a daily rate and a refundable deposit.`,
  },
  {
    title: "Request your dates",
    body: "Choose a start date from tomorrow onwards and an end date. Both dates count as rental days.",
  },
  {
    title: "Provider confirms",
    body: "The provider accepts or declines your request. Only a confirmed booking reserves the item.",
  },
  {
    title: "Hand over and return",
    body: "You and the provider both confirm the handover, and later the return and deposit settlement.",
  },
] as const;

const HERO_IMAGES = [
  { src: "/images/listings/sofa-three-seater.webp", alt: "Illustration of a green fabric sofa" },
  { src: "/images/listings/bicycle-geared.webp", alt: "Illustration of a red geared bicycle" },
  { src: "/images/listings/study-table-chair.webp", alt: "Illustration of a study table with a chair" },
  { src: "/images/listings/refrigerator-single-door.webp", alt: "Illustration of a single-door refrigerator" },
] as const;

async function HomePage() {
  // Newest approved listings from active providers (real data, not samples).
  const featured = await searchCatalogue(parseCatalogueFilters({}), 4);
  const featuredListings = featured?.rows ?? [];

  return (
    <>
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pt-12 pb-16 sm:px-6 md:pt-20 lg:grid-cols-2 lg:gap-14">
        <div>
          <p className="text-sm font-medium text-primary">
            Short stay in {SERVICE_CITY}?
          </p>
          <h1 className="mt-3 text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
            Rent essentials, not expenses.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-pretty text-muted-foreground">
            Students, interns, and working professionals can rent furniture,
            appliances, bicycles, and study gear from local providers for as
            long as they need them, instead of buying things they will leave
            behind.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/listings"
              className={buttonVariants({ size: "lg", className: "h-11 px-5 text-base" })}
            >
              Browse listings
              <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
            </Link>
            <Link
              href="#how-it-works"
              className={buttonVariants({
                variant: "outline",
                size: "lg",
                className: "h-11 px-5 text-base",
              })}
            >
              How it works
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          {HERO_IMAGES.map((image, index) => (
            <div
              key={image.src}
              className="relative aspect-4/3 overflow-hidden rounded-xl border border-border bg-muted"
            >
              <Image
                src={image.src}
                alt={image.alt}
                fill
                priority={index < 2}
                sizes="(min-width: 1024px) 25vw, 50vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="categories-heading"
        className="border-y border-border bg-card"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="categories-heading" className="text-2xl font-semibold tracking-tight">
            Browse by category
          </h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {LISTING_CATEGORIES.map((category) => {
              const Icon = CATEGORY_ICONS[category.slug];
              return (
                <li key={category.slug}>
                  <Link
                    href={{ pathname: "/listings", query: { category: category.slug } }}
                    className="group flex h-full items-start gap-3 rounded-xl border border-border bg-background p-4 transition-colors duration-200 hover:border-primary/40 hover:bg-accent"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <span>
                      <span className="block font-medium">{category.label}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {category.description}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section
        id="how-it-works"
        aria-labelledby="how-it-works-heading"
        className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6"
      >
        <h2 id="how-it-works-heading" className="text-2xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS_STEPS.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-border bg-card p-5">
              <span
                aria-hidden="true"
                className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
              >
                {index + 1}
              </span>
              <h3 className="mt-4 font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
        <Link
          href="/how-it-works"
          className="group mt-8 block overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-primary/40"
        >
          <Image
            src="/images/how-it-works/05-rental-and-return-flow.webp"
            alt="A successful rental in eight steps, shown with screenshots from the app: request, confirm, handover by both, agree a return, settle the deposit, both confirm, completed."
            width={2400}
            height={1350}
            sizes="(min-width: 1152px) 1104px, 100vw"
            className="h-auto w-full"
          />
          <span className="flex items-center gap-1 border-t border-border px-5 py-3 text-sm font-medium text-primary">
            See every flow with real screenshots: renters, providers and admins
            <ArrowRightIcon aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      </section>

      <section
        aria-labelledby="featured-heading"
        className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="featured-heading" className="text-2xl font-semibold tracking-tight">
              Recently listed
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Approved items from providers in {SERVICE_CITY}.
            </p>
          </div>
          <Link
            href="/listings"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            View all listings
            <ArrowRightIcon aria-hidden="true" className="size-4" />
          </Link>
        </div>
        {featuredListings.length > 0 ? (
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featuredListings.map((listing) => (
              <li key={listing.id}>
                <ListingCard listing={listing} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
            {featured === null
              ? "Listings could not be loaded right now."
              : `No listings yet. Providers in ${SERVICE_CITY} are adding items; check back soon.`}
          </p>
        )}
      </section>

      <section aria-labelledby="confirmation-heading" className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
        <div className="rounded-2xl border border-border bg-accent p-6 sm:p-10">
          <h2
            id="confirmation-heading"
            className="text-xl font-semibold tracking-tight text-accent-foreground sm:text-2xl"
          >
            Providers confirm every request
          </h2>
          <ul className="mt-4 grid gap-3 text-sm text-foreground sm:grid-cols-2">
            <li>
              A rental request is not a booking. The provider reviews it and
              accepts or declines.
            </li>
            <li>
              Pending requests do not reserve the item. Only a confirmed booking
              holds your dates.
            </li>
            <li>
              Listings show only the area and a nearby landmark. The exact
              pickup address is shared after the booking is confirmed.
            </li>
            <li>
              Prices and deposits are fixed from the listing when the booking is
              made, not edited along the way.
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <HomePage />
    </Suspense>
  );
}
