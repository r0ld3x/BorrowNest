import type { Metadata } from "next";
import { Suspense } from "react";

import { UpdateNameForm } from "@/components/auth/auth-forms";
import { FormMessage } from "@/components/auth/form-parts";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageLoading } from "@/components/layout/page-loading";
import { ROLE_LABELS } from "@/lib/auth/redirects";
import { requireActiveProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account" };

const NOTICES = {
  "password-updated": "Your password has been updated.",
} as const;

async function AccountPage({ searchParams }: PageProps<"/account">) {
  const profile = await requireActiveProfile("/account");
  const { notice } = await searchParams;

  // getUser() asks Supabase Auth for the current user record (email is
  // owned by Auth, not duplicated in profiles).
  const supabase = await createClient();
  const email = supabase ? (await supabase.auth.getUser()).data.user?.email : undefined;

  const noticeMessage =
    typeof notice === "string" && notice in NOTICES ? NOTICES[notice as keyof typeof NOTICES] : null;

  return (
    <DashboardShell profile={profile} title="Account">
      <div className="grid max-w-2xl gap-6">
        {noticeMessage ? <FormMessage status="success" message={noticeMessage} /> : null}
        <section aria-labelledby="profile-heading" className="rounded-xl border border-border bg-card p-6">
          <h2 id="profile-heading" className="font-semibold">
            Profile
          </h2>
          <div className="mt-4">
            {/* Only the name crosses to the client component. */}
            <UpdateNameForm fullName={profile.fullName} />
          </div>
        </section>
        <section aria-labelledby="details-heading" className="rounded-xl border border-border bg-card p-6">
          <h2 id="details-heading" className="font-semibold">
            Account details
          </h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="break-all">{email ?? "Unavailable"}</dd>
            <dt className="text-muted-foreground">Account type</dt>
            <dd>{ROLE_LABELS[profile.role]}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="capitalize">{profile.accountStatus}</dd>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Account types can only be changed by BorrowNest administrators.
          </p>
        </section>
      </div>
    </DashboardShell>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page(props: PageProps<"/account">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <AccountPage {...props} />
    </Suspense>
  );
}
