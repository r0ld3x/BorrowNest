import type { Metadata } from "next";
import { Suspense } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageLoading } from "@/components/layout/page-loading";
import { ListingForm } from "@/components/listings/provider/listing-form";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New listing" };

async function NewListingPage() {
  const profile = await requireRole(["provider"]);

  return (
    <DashboardShell profile={profile} title="New listing">
      <div className="max-w-3xl rounded-xl border border-border bg-card p-6 sm:p-8">
        <p className="mb-6 text-sm text-muted-foreground">
          Start with the details. You will add photos on the next screen, then submit for review.
        </p>
        <ListingForm />
      </div>
    </DashboardShell>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <NewListingPage />
    </Suspense>
  );
}
