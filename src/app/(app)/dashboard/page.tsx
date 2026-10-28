import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageLoading } from "@/components/layout/page-loading";
import { dashboardPathFor } from "@/lib/auth/redirects";
import { requireActiveProfile } from "@/lib/auth/session";

// Sends each user to the dashboard for their current database role.
async function DashboardRouterPage(): Promise<never> {
  const profile = await requireActiveProfile("/dashboard");
  redirect(dashboardPathFor(profile.role));
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <DashboardRouterPage />
    </Suspense>
  );
}
