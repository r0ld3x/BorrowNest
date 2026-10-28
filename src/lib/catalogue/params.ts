// Browser-safe parsing of untrusted catalogue query parameters. Every value
// is allowlisted or bounded here; the database functions re-check and escape.

import { parseCategoryParam, type ListingCategorySlug } from "@/lib/constants";

export const CATALOGUE_SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "price_asc", label: "Daily rate: low to high" },
  { value: "price_desc", label: "Daily rate: high to low" },
] as const;

export type CatalogueSort = (typeof CATALOGUE_SORTS)[number]["value"];

export const CATALOGUE_PAGE_SIZE = 12;
const MAX_PAGE = 200;
const MAX_PRICE = 50000;

type Param = string | string[] | undefined;

export interface CatalogueFilters {
  q: string;
  category: ListingCategorySlug | null;
  area: string;
  min: number | null;
  max: number | null;
  sort: CatalogueSort;
  page: number;
  /** True when some supplied value was unusable and was dropped. */
  ignored: boolean;
}

function single(value: Param): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function cleanText(value: string | undefined, maxLength: number): string {
  if (!value) return "";
  return value.replace(/[\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function parsePrice(value: string | undefined): { price: number | null; bad: boolean } {
  if (value === undefined || value.trim() === "") return { price: null, bad: false };
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(value.trim())) return { price: null, bad: true };
  const price = Number(value);
  return price > MAX_PRICE ? { price: null, bad: true } : { price, bad: false };
}

export function parseCatalogueFilters(params: Record<string, Param>): CatalogueFilters {
  let ignored = false;

  const category = parseCategoryParam(params.category);
  if (category === "invalid") ignored = true;

  const rawSort = single(params.sort);
  const sort = CATALOGUE_SORTS.some((s) => s.value === rawSort) ? (rawSort as CatalogueSort) : "newest";
  if (rawSort !== undefined && sort !== rawSort) ignored = true;

  const minResult = parsePrice(single(params.min));
  const maxResult = parsePrice(single(params.max));
  if (minResult.bad || maxResult.bad) ignored = true;
  let { price: min } = minResult;
  let { price: max } = maxResult;
  if (min !== null && max !== null && min > max) [min, max] = [max, min];

  const rawPage = single(params.page);
  const page = rawPage && /^\d{1,4}$/.test(rawPage) ? Math.min(Math.max(Number(rawPage), 1), MAX_PAGE) : 1;

  for (const key of ["q", "category", "area", "min", "max", "sort", "page"]) {
    if (Array.isArray(params[key])) ignored = true;
  }

  return {
    q: cleanText(single(params.q), 100),
    category: category === "invalid" ? null : category,
    area: cleanText(single(params.area), 80),
    min,
    max,
    sort,
    page,
    ignored,
  };
}

/** Query object for links: only non-default, already-validated values. */
export function filtersToQuery(filters: Partial<CatalogueFilters>): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.q) query.q = filters.q;
  if (filters.category) query.category = filters.category;
  if (filters.area) query.area = filters.area;
  if (filters.min !== null && filters.min !== undefined) query.min = String(filters.min);
  if (filters.max !== null && filters.max !== undefined) query.max = String(filters.max);
  if (filters.sort && filters.sort !== "newest") query.sort = filters.sort;
  if (filters.page && filters.page > 1) query.page = String(filters.page);
  return query;
}

export function hasActiveFilters(filters: CatalogueFilters): boolean {
  return Boolean(filters.q || filters.category || filters.area || filters.min !== null || filters.max !== null);
}
