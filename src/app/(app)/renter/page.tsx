import type { Metadata } from "next";

import { DashboardShell, UpcomingPanel } from "@/components/dashboard/dashboard-shell";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Renter dashboard" };

export default async function RenterDashboardPage() {
  const profile = await requireRole(["renter"], "/renter");

  return (
    <DashboardShell profile={profile} title="Your rentals">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-semibold">No rentals yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Rental requests are not open yet, so there is nothing to show here.
            You can preview sample listings in the meantime.
          </p>
        </section>
        <UpcomingPanel
          title="Coming in later stages"
          items={[
            "Request items for your dates from Gwalior providers.",
            "Track requests until a provider accepts or declines them.",
            "See the pickup address once a booking is confirmed.",
            "Confirm handover and return together with the provider.",
          ]}
        />
      </div>
    </DashboardShell>
  );
}
