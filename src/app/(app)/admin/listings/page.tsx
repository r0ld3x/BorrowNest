import { ImageIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { FilterTabs, Pagination, SearchForm } from "@/components/common/list-controls";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageLoading } from "@/components/layout/page-loading";
import { ListingStatusBadge } from "@/components/listings/provider/listing-status-badge";
import { parseListingStatus, parsePage, parseSearch } from "@/lib/admin/params";
import { listListingsForAdmin } from "@/lib/admin/queries";
import { requireRole } from "@/lib/auth/session";
import { LISTING_STATUS_LABELS } from "@/lib/listings/options";
import { formatInr } from "@/lib/utils";

export const metadata: Metadata = { title: "Listings · Admin" };

const STATUS_TABS = [
  { value: "pending_review", label: "Waiting for review" },
  { value: "published", label: LISTING_STATUS_LABELS.published },
  { value: "rejected", label: LISTING_STATUS_LABELS.rejected },
  { value: "paused", label: LISTING_STATUS_LABELS.paused },
  { value: "draft", label: LISTING_STATUS_LABELS.draft },
  { value: "archived", label: LISTING_STATUS_LABELS.archived },
  { value: "all", label: "All" },
] as const;

const dateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

async function AdminListingsPage({ searchParams }: PageProps<"/admin/listings">) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;
  const status = parseListingStatus(params.status);
  const search = parseSearch(params.q);
  const page = parsePage(params.page);

  const result = await listListingsForAdmin(status === "all" ? null : status, search, page);
  const query = { status, q: search || undefined };

  return (
    <DashboardShell profile={profile} title="Listings">
      <div className="grid gap-4">
        <FilterTabs pathname="/admin/listings" active={status} options={STATUS_TABS} query={{ q: search || undefined }} />
        <SearchForm pathname="/admin/listings" search={search} label="Search title, area or provider" hidden={{ status }} />
      </div>

      {result === null ? (
        <p role="alert" className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Listings could not be loaded. Please try again later.
        </p>
      ) : result.rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          {search ? "No listings match your search." : status === "pending_review" ? "Nothing is waiting for review." : "No listings here yet."}
        </p>
      ) : (
        <>
          <ul className="mt-6 grid gap-3">
            {result.rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/admin/listings/${row.id}`}
                  className="flex gap-4 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent sm:items-center"
                >
                  <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-muted sm:size-24">
                    {row.coverUrl ? (
                      <Image src={row.coverUrl} alt="" fill sizes="96px" className="object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <ImageIcon aria-hidden="true" className="size-6" />
                      </div>
                    )}
                  </div>
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 font-semibold wrap-break-word">{row.title}</h2>
                      <ListingStatusBadge status={row.listing_status} />
                      {row.provider_status === "suspended" ? (
                        <span className="rounded-full border border-destructive/40 px-2 text-xs text-destructive">Provider suspended</span>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {row.area} · {formatInr(row.price_per_day)} / day · deposit {formatInr(row.deposit)} · {row.image_count}{" "}
                      {row.image_count === 1 ? "photo" : "photos"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      By {row.provider_name} · updated {dateTime.format(new Date(row.updated_at))}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination pathname="/admin/listings" page={result.page} pageCount={result.pageCount} total={result.total} query={query} />
        </>
      )}
    </DashboardShell>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page(props: PageProps<"/admin/listings">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <AdminListingsPage {...props} />
    </Suspense>
  );
}
