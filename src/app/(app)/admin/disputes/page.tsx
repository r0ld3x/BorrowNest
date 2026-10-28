import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FilterTabs, Pagination } from "@/components/common/list-controls";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DisputeStatusBadge } from "@/components/disputes/dispute-section";
import { CATEGORY_LABELS } from "@/components/disputes/labels";
import { PageLoading } from "@/components/layout/page-loading";
import { parsePage } from "@/lib/admin/params";
import { requireRole } from "@/lib/auth/session";
import { listDisputes } from "@/lib/bookings/disputes";
import type { DisputeStatus } from "@/types/database";

export const metadata: Metadata = { title: "Disputes · Admin" };

const TABS = [
  { value: "attention", label: "Needs attention" },
  { value: "open", label: "Open" },
  { value: "in_review", label: "In review" },
  { value: "needs_info", label: "Info requested" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
] as const;

const opened = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

function parseTab(value: string | string[] | undefined) {
  return TABS.some((t) => t.value === value) ? (value as (typeof TABS)[number]["value"]) : "attention";
}

async function AdminDisputesPage({ searchParams }: PageProps<"/admin/disputes">) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;
  const tab = parseTab(params.status);
  const page = parsePage(params.page);
  const result = await listDisputes(tab === "attention" ? null : (tab as DisputeStatus | "all"), page);

  return (
    <DashboardShell profile={profile} title="Disputes">
      <div className="mb-4 grid gap-3">
        <FilterTabs pathname="/admin/disputes" active={tab} options={TABS} />
        <p className="text-sm text-muted-foreground">
          Oldest first. An unresolved dispute holds the booking’s handover and return confirmations. Disputes are private to the two
          participants and admins.
        </p>
      </div>
      {result === null ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Disputes could not be loaded. Please try again later.
        </p>
      ) : result.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">No disputes here.</p>
      ) : (
        <>
          <ul className="grid gap-3">
            {result.rows.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/admin/disputes/${d.id}`}
                  className="grid gap-1 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="font-semibold wrap-break-word">
                      {CATEGORY_LABELS[d.category]} · {d.product_title}
                    </span>
                    <DisputeStatusBadge status={d.status} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Opened by {d.opened_by_role === "admin" ? `support for the ${d.on_behalf_of}` : `the ${d.opened_by_role}`} ·{" "}
                    {opened.format(new Date(d.created_at))} · {d.message_count} {d.message_count === 1 ? "statement" : "statements"}
                    {d.post_completion ? " · after completion" : ""} · booking {d.booking_status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination pathname="/admin/disputes" page={result.page} pageCount={result.pageCount} total={result.total} query={{ status: tab }} />
        </>
      )}
    </DashboardShell>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page(props: PageProps<"/admin/disputes">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <AdminDisputesPage {...props} />
    </Suspense>
  );
}
