import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuditList } from "@/components/admin/audit-list";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageLoading } from "@/components/layout/page-loading";
import { getAdminOverview, listAuditForAdmin } from "@/lib/admin/queries";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin dashboard" };

async function AdminDashboardPage() {
  const profile = await requireRole(["admin"], "/admin");
  const [overview, recent] = await Promise.all([getAdminOverview(), listAuditForAdmin(null, 1, 5)]);

  // Real counts from the database; nothing here is estimated or mocked.
  const cards = overview
    ? [
        { label: "Waiting for review", value: overview.pending_review, href: "/admin/listings?status=pending_review", highlight: overview.pending_review > 0 },
        { label: "Published listings", value: overview.published, href: "/admin/listings?status=published" },
        { label: "Rejected listings", value: overview.rejected, href: "/admin/listings?status=rejected" },
        { label: "All listings", value: overview.total_listings, href: "/admin/listings?status=all" },
        { label: "Accounts", value: overview.accounts, href: "/admin/users" },
        { label: "Suspended accounts", value: overview.suspended_accounts, href: "/admin/users" },
      ]
    : [];

  return (
    <DashboardShell profile={profile} title="Administration">
      {overview === null ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          The overview could not be loaded. Please try again later.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <li key={card.label}>
              <Link
                href={card.href}
                className={`flex h-full flex-col gap-1 rounded-xl border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-accent ${
                  card.highlight ? "border-primary/50" : "border-border"
                }`}
              >
                <span className="text-sm text-muted-foreground">{card.label}</span>
                <span className="text-3xl font-semibold tabular-nums">{card.value}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="recent-heading" className="mt-8 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-heading" className="font-semibold">
            Recent admin activity
          </h2>
          <Link href="/admin/activity" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            View all
          </Link>
        </div>
        <div className="mt-2">
          {recent ? (
            <AuditList entries={recent.rows} />
          ) : (
            <p role="alert" className="text-sm text-destructive">Activity could not be loaded.</p>
          )}
        </div>
      </section>
    </DashboardShell>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <AdminDashboardPage />
    </Suspense>
  );
}
