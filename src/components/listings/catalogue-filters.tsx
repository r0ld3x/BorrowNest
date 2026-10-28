import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { CATALOGUE_SORTS, type CatalogueFilters } from "@/lib/catalogue/params";
import { LISTING_CATEGORIES } from "@/lib/constants";
import { cn } from "@/lib/utils";

const FIELD =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * Plain GET form: works without JavaScript, and every value it submits is
 * re-validated by parseCatalogueFilters on the server. Rendered twice (desktop
 * panel and mobile sheet), so element ids take a prefix.
 */
export function CatalogueFilterForm({
  filters,
  areas,
  idPrefix,
}: {
  filters: CatalogueFilters;
  areas: { area: string; count: number }[];
  idPrefix: string;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const areaKnown = areas.some((a) => a.area.toLowerCase() === filters.area.toLowerCase());

  return (
    <form action="/listings" method="get" className="grid gap-4" aria-label="Filter listings">
      <div className="grid gap-1.5">
        <label htmlFor={id("q")} className="text-sm font-medium">
          Search
        </label>
        <input id={id("q")} name="q" type="search" maxLength={100} defaultValue={filters.q} placeholder="e.g. study table" className={FIELD} />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={id("category")} className="text-sm font-medium">
          Category
        </label>
        <select id={id("category")} name="category" defaultValue={filters.category ?? ""} className={FIELD}>
          <option value="">All categories</option>
          {LISTING_CATEGORIES.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={id("area")} className="text-sm font-medium">
          Area in Gwalior
        </label>
        <select id={id("area")} name="area" defaultValue={areaKnown ? filters.area : ""} className={FIELD}>
          <option value="">All areas</option>
          {areas.map((a) => (
            <option key={a.area} value={a.area}>
              {a.area} ({a.count})
            </option>
          ))}
        </select>
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Daily rate (₹)</legend>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <label htmlFor={id("min")} className="text-xs text-muted-foreground">
              Min
            </label>
            <input id={id("min")} name="min" inputMode="decimal" maxLength={9} defaultValue={filters.min ?? ""} className={FIELD} />
          </div>
          <div className="grid gap-1">
            <label htmlFor={id("max")} className="text-xs text-muted-foreground">
              Max
            </label>
            <input id={id("max")} name="max" inputMode="decimal" maxLength={9} defaultValue={filters.max ?? ""} className={FIELD} />
          </div>
        </div>
      </fieldset>
      <div className="grid gap-1.5">
        <label htmlFor={id("sort")} className="text-sm font-medium">
          Sort by
        </label>
        <select id={id("sort")} name="sort" defaultValue={filters.sort} className={FIELD}>
          {CATALOGUE_SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonVariants({ className: "h-10 flex-1 px-4" })}>
          Apply filters
        </button>
        <Link href="/listings" className={cn(buttonVariants({ variant: "outline", className: "h-10 px-4" }))}>
          Clear
        </Link>
      </div>
    </form>
  );
}
