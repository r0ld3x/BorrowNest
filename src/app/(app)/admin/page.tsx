import type { Metadata } from "next";

import { DashboardShell, UpcomingPanel } from "@/components/dashboard/dashboard-shell";
import { ROLE_LABELS } from "@/lib/auth/redirects";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin dashboard" };

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: "Asia/Kolkata",
});

export default async function AdminDashboardPage() {
  const profile = await requireRole(["admin"], "/admin");

  // The admin read policy is enforced in the database, not by this page.
  const supabase = await createClient();
  const { data: profiles, error } = supabase
    ? await supabase
        .from("profiles")
        .select("id, full_name, role, account_status, created_at")
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: null, error: null };

  return (
    <DashboardShell profile={profile} title="Administration">
      <div className="grid gap-6">
        <section aria-labelledby="accounts-heading" className="rounded-xl border border-border bg-card p-6">
          <h2 id="accounts-heading" className="font-semibold">
            Recent accounts
          </h2>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              Accounts could not be loaded. Please try again later.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <caption className="sr-only">Most recent 50 accounts</caption>
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-3 font-medium">Name</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Role</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                    <th scope="col" className="py-2 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(profiles ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="max-w-64 py-2.5 pr-3 break-words">{row.full_name}</td>
                      <td className="py-2.5 pr-3">{ROLE_LABELS[row.role]}</td>
                      <td className="py-2.5 pr-3 capitalize">{row.account_status}</td>
                      <td className="py-2.5">{dateFormatter.format(new Date(row.created_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <UpcomingPanel
          title="Coming in later stages"
          items={[
            "Review listings submitted for publication.",
            "Suspend or restore accounts, with an audit trail.",
            "Resolve rental disputes with recorded decisions.",
          ]}
        />
      </div>
    </DashboardShell>
  );
}
