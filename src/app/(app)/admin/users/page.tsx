import type { Metadata } from "next";

import { AccountStatusControl } from "@/components/admin/account-status-control";
import { FormMessage } from "@/components/auth/form-parts";
import { Pagination, SearchForm } from "@/components/admin/list-controls";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { parsePage, parseSearch } from "@/lib/admin/params";
import { listAccountsForAdmin } from "@/lib/admin/queries";
import { ROLE_LABELS } from "@/lib/auth/redirects";
import { requireRole } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Accounts · Admin" };

const date = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

// Fixed confirmation texts keyed by allowlisted codes; the query value is never echoed.
const NOTICES = {
  suspended:
    "Account suspended. Protected access and any public listings stopped immediately. Sessions already open are not signed out, but their protected requests are refused.",
  restored: "Account restored.",
} as const;

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;
  const search = parseSearch(params.q);
  const page = parsePage(params.page);
  const notice = typeof params.notice === "string" && params.notice in NOTICES ? NOTICES[params.notice as keyof typeof NOTICES] : null;
  const result = await listAccountsForAdmin(search, page);

  return (
    <DashboardShell profile={profile} title="Accounts">
      {notice ? (
        <div className="mb-4">
          <FormMessage status="success" message={notice} />
        </div>
      ) : null}
      <div className="grid gap-3">
        <SearchForm pathname="/admin/users" search={search} label="Search name or email" />
        <p className="text-xs text-muted-foreground">
          Roles can only be changed by an operator. Admins never see passwords or session tokens.
        </p>
      </div>

      {result === null ? (
        <p role="alert" className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Accounts could not be loaded. Please try again later.
        </p>
      ) : result.rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          No accounts match your search.
        </p>
      ) : (
        <>
          <ul className="mt-6 grid gap-3">
            {result.rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="grid min-w-0 gap-1 text-sm">
                  <p className="font-semibold wrap-break-word">{row.full_name}</p>
                  <p className="break-all text-muted-foreground">{row.email ?? "No email"}</p>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{ROLE_LABELS[row.role]}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 font-medium",
                        row.account_status === "active"
                          ? "border-primary/40 text-accent-foreground"
                          : "border-destructive/40 text-destructive",
                      )}
                    >
                      {row.account_status === "active" ? "Active" : "Suspended"}
                    </span>
                    {row.role === "provider" ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {row.listing_count} {row.listing_count === 1 ? "listing" : "listings"}
                        </span>
                      </>
                    ) : null}
                    <span aria-hidden="true">·</span>
                    <span>Joined {date.format(new Date(row.created_at))}</span>
                  </p>
                </div>
                <AccountStatusControl
                  key={`${row.id}-${row.account_status}`}
                  profileId={row.id}
                  name={row.full_name}
                  role={row.role}
                  status={row.account_status}
                  isSelf={row.id === profile.id}
                  search={search}
                />
              </li>
            ))}
          </ul>
          <Pagination pathname="/admin/users" page={result.page} pageCount={result.pageCount} total={result.total} query={{ q: search || undefined }} />
        </>
      )}
    </DashboardShell>
  );
}
