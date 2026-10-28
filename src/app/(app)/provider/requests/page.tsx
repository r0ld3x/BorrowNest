import { InboxIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FormMessage } from "@/components/auth/form-parts";
import { BookingDecisionControls } from "@/components/bookings/booking-decision-controls";
import { BookingQuote, BookingStatusBadge } from "@/components/bookings/booking-parts";
import { FilterTabs, Pagination } from "@/components/common/list-controls";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageLoading } from "@/components/layout/page-loading";
import { parsePage } from "@/lib/admin/params";
import { requireRole } from "@/lib/auth/session";
import { listProviderRequests } from "@/lib/bookings/queries";
import type { BookingStatus } from "@/types/database";

export const metadata: Metadata = { title: "Rental requests" };

const TABS = [
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "rejected", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
  { value: "completed", label: "Completed" },
  { value: "closed", label: "Closed by support" },
  { value: "all", label: "All" },
] as const;

function parseStatus(value: string | string[] | undefined): BookingStatus | "all" {
  return TABS.some((t) => t.value === value) ? (value as BookingStatus | "all") : "pending";
}

// Fixed confirmation texts keyed by allowlisted codes; the query value is never echoed.
const NOTICES = {
  confirmed: "Request confirmed. The dates are reserved and the renter can now see your pickup address.",
  declined: "Request declined. The renter has been told.",
} as const;

const received = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

async function ProviderRequestsPage({ searchParams }: PageProps<"/provider/requests">) {
  const profile = await requireRole(["provider"]);
  const params = await searchParams;
  const status = parseStatus(params.status);
  const page = parsePage(params.page);
  const result = await listProviderRequests(status === "all" ? null : status, page);
  const notice = typeof params.notice === "string" && params.notice in NOTICES ? NOTICES[params.notice as keyof typeof NOTICES] : null;

  return (
    <DashboardShell profile={profile} title="Rental requests">
      <div className="grid gap-3">
        {notice ? <FormMessage status="success" message={notice} /> : null}
        <FilterTabs pathname="/provider/requests" active={status} options={TABS} />
        <p className="text-sm text-muted-foreground">
          Requests for your listings, soonest first. Pending requests don’t reserve anything until you confirm one.
        </p>
      </div>

      {result === null ? (
        <p role="alert" className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Requests could not be loaded. Please try again later.
        </p>
      ) : result.rows.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <InboxIcon aria-hidden="true" className="size-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">No requests here</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">When renters request your published items, they appear here.</p>
        </div>
      ) : (
        <>
          <ul className="mt-6 grid gap-4 lg:grid-cols-2">
            {result.rows.map((r) => (
              <li key={r.id} className="grid content-start gap-4 rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-semibold wrap-break-word">
                      <Link href={`/provider/requests/${r.id}`} className="underline-offset-4 hover:underline">
                        {r.product_title}
                      </Link>
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      From {r.renter_name ?? "a renter"} · received {received.format(new Date(r.created_at))}
                    </p>
                  </div>
                  <BookingStatusBadge status={r.status} />
                </div>
                {r.no_longer_available ? (
                  <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                    No longer available: another booking for these dates is confirmed.
                  </p>
                ) : null}
                <BookingQuote booking={r} />
                {r.note ? (
                  <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                    <p className="font-medium">Renter’s note</p>
                    <p className="mt-1 whitespace-pre-line text-muted-foreground wrap-break-word">{r.note}</p>
                  </div>
                ) : null}
                {r.status === "pending" ? (
                  <BookingDecisionControls
                    key={`${r.id}-${r.status}`}
                    bookingId={r.id}
                    actions={["confirm", "reject"]}
                    confirmBlockedReason={
                      r.no_longer_available
                        ? "These dates are already reserved, so this request can only be declined."
                        : r.pickup_expired
                          ? "The requested pickup time has passed, so this request can only be declined."
                          : null
                    }
                  />
                ) : r.status === "confirmed" ? (
                  <Link
                    href={`/provider/requests/${r.id}`}
                    className="justify-self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Open booking and handover
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
          <Pagination pathname="/provider/requests" page={result.page} pageCount={result.pageCount} total={result.total} query={{ status }} />
        </>
      )}
    </DashboardShell>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page(props: PageProps<"/provider/requests">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ProviderRequestsPage {...props} />
    </Suspense>
  );
}
