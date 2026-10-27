import type { Metadata } from "next";

import { DashboardShell, UpcomingPanel } from "@/components/dashboard/dashboard-shell";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Provider dashboard" };

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  published: "Published",
  paused: "Paused",
  rejected: "Rejected",
  archived: "Archived",
};

export default async function ProviderDashboardPage() {
  const profile = await requireRole(["provider"], "/provider");

  // RLS returns only this provider's own listings.
  const supabase = await createClient();
  const { data: listings, error } = supabase
    ? await supabase
        .from("products")
        .select("id, title, listing_status, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50)
    : { data: null, error: null };

  return (
    <DashboardShell profile={profile} title="Your listings">
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="listings-heading" className="rounded-xl border border-border bg-card p-6">
          <h2 id="listings-heading" className="font-semibold">
            Listings
          </h2>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              Your listings could not be loaded. Please try again later.
            </p>
          ) : listings && listings.length > 0 ? (
            <ul className="mt-3 divide-y divide-border text-sm">
              {listings.map((listing) => (
                <li key={listing.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0 break-words">{listing.title}</span>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs">
                    {STATUS_LABELS[listing.listing_status] ?? listing.listing_status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              You have no listings yet. Creating and managing listings arrives in
              the next stage.
            </p>
          )}
        </section>
        <UpcomingPanel
          title="Coming in later stages"
          items={[
            "Create listings with photos, daily rates, and refundable deposits.",
            "Submit listings for review before they are published.",
            "Accept or decline rental requests for your items.",
            "Confirm handover and return together with the renter.",
          ]}
        />
      </div>
    </DashboardShell>
  );
}
