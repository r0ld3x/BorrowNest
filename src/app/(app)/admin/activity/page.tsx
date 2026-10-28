import type { Metadata } from "next";
import { Suspense } from "react";

import { AuditList } from "@/components/admin/audit-list";
import { Pagination } from "@/components/common/list-controls";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageLoading } from "@/components/layout/page-loading";
import { parsePage } from "@/lib/admin/params";
import { listAuditForAdmin } from "@/lib/admin/queries";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Activity · Admin" };

async function AdminActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  const profile = await requireRole(["admin"]);
  const page = parsePage((await searchParams).page);
  const result = await listAuditForAdmin(null, page);

  return (
    <DashboardShell profile={profile} title="Activity">
      <p className="mb-4 text-sm text-muted-foreground">
        Every admin decision, correction and account change, newest first. Entries can’t be edited or deleted.
      </p>
      <section className="rounded-xl border border-border bg-card p-6">
        {result ? <AuditList entries={result.rows} /> : <p role="alert" className="text-sm text-destructive">Activity could not be loaded.</p>}
      </section>
      {result ? <Pagination pathname="/admin/activity" page={result.page} pageCount={result.pageCount} total={result.total} /> : null}
    </DashboardShell>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page(props: PageProps<"/admin/activity">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <AdminActivityPage {...props} />
    </Suspense>
  );
}
