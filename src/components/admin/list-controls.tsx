import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Query = Record<string, string | undefined>;

function hrefWith(pathname: string, query: Query) {
  const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v)) as Record<string, string>;
  return { pathname, query: params };
}

/** Plain GET form: works without JavaScript, values travel as query params. */
export function SearchForm({
  pathname,
  search,
  label,
  hidden = {},
}: {
  pathname: string;
  search: string;
  label: string;
  hidden?: Query;
}) {
  return (
    <form action={pathname} method="get" role="search" className="flex w-full max-w-md gap-2">
      {Object.entries(hidden).map(([name, value]) => (value ? <input key={name} type="hidden" name={name} value={value} /> : null))}
      <label htmlFor="admin-search" className="sr-only">
        {label}
      </label>
      <Input id="admin-search" name="q" type="search" defaultValue={search} maxLength={100} placeholder={label} className="h-10" />
      <button type="submit" className={buttonVariants({ variant: "outline", className: "h-10 px-3" })}>
        <SearchIcon aria-hidden="true" data-icon="inline-start" />
        Search
      </button>
    </form>
  );
}

export function Pagination({
  pathname,
  page,
  pageCount,
  total,
  query = {},
}: {
  pathname: string;
  page: number;
  pageCount: number;
  total: number;
  query?: Query;
}) {
  if (total === 0) return null;
  const link = (target: number) => hrefWith(pathname, { ...query, page: target > 1 ? String(target) : undefined });
  const linkClass = buttonVariants({ variant: "outline", size: "sm", className: "h-8" });

  return (
    <nav aria-label="Pagination" className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">
        Page {page} of {pageCount} · {total} {total === 1 ? "result" : "results"}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={link(page - 1)} className={linkClass} rel="prev">
            <ChevronLeftIcon aria-hidden="true" data-icon="inline-start" />
            Previous
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link href={link(page + 1)} className={linkClass} rel="next">
            Next
            <ChevronRightIcon aria-hidden="true" data-icon="inline-end" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function FilterTabs({
  pathname,
  active,
  options,
  query = {},
}: {
  pathname: string;
  active: string;
  options: readonly { value: string; label: string }[];
  query?: Query;
}) {
  return (
    <nav aria-label="Filter by status">
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = option.value === active;
          return (
            <li key={option.value}>
              <Link
                href={hrefWith(pathname, { ...query, status: option.value })}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium transition-colors duration-150",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-primary/40 hover:bg-accent",
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
