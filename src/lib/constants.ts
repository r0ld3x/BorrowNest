// Browser-safe constants. Never put secrets or server-only values here.

export const SITE_NAME = "BorrowNest";
export const SITE_TAGLINE = "Rent Essentials, Not Expenses";
export const SERVICE_CITY = "Gwalior";

export const PRIMARY_NAV_LINKS = [
  { href: "/listings", label: "Browse listings" },
  { href: "/#how-it-works", label: "How it works" },
] as const;

export const LISTING_CATEGORIES = [
  {
    slug: "furniture",
    label: "Furniture",
    description: "Sofas, beds, and storage for your stay.",
  },
  {
    slug: "appliances",
    label: "Appliances",
    description: "Refrigerators, washing machines, and more.",
  },
  {
    slug: "bicycles",
    label: "Bicycles",
    description: "Get around the city on two wheels.",
  },
  {
    slug: "study",
    label: "Study essentials",
    description: "Desks, chairs, shelves, and lamps.",
  },
  {
    slug: "kitchen",
    label: "Kitchen equipment",
    description: "Cooktops, cookware, and small appliances.",
  },
  {
    slug: "household",
    label: "Household items",
    description: "Everyday items for a temporary home.",
  },
] as const;

export type ListingCategorySlug = (typeof LISTING_CATEGORIES)[number]["slug"];

const CATEGORY_SLUGS: ReadonlySet<string> = new Set(
  LISTING_CATEGORIES.map((category) => category.slug),
);

export function isListingCategorySlug(
  value: string,
): value is ListingCategorySlug {
  return CATEGORY_SLUGS.has(value);
}

/**
 * Parses an untrusted `category` query value against the allowlist.
 * Returns `null` when absent and `"invalid"` when present but unsupported,
 * so callers never echo or reuse the raw value.
 */
export function parseCategoryParam(
  value: string | string[] | undefined,
): ListingCategorySlug | null | "invalid" {
  if (value === undefined) return null;
  if (Array.isArray(value)) return "invalid";
  return isListingCategorySlug(value) ? value : "invalid";
}

export function getCategoryLabel(slug: ListingCategorySlug): string {
  return (
    LISTING_CATEGORIES.find((category) => category.slug === slug)?.label ??
    slug
  );
}
