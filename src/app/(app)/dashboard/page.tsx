import { redirect } from "next/navigation";

import { dashboardPathFor } from "@/lib/auth/redirects";
import { requireActiveProfile } from "@/lib/auth/session";

// Sends each user to the dashboard for their current database role.
export default async function DashboardRouterPage() {
  const profile = await requireActiveProfile("/dashboard");
  redirect(dashboardPathFor(profile.role));
}
