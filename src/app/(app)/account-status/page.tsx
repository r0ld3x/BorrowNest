import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { LogoutButton } from "@/components/auth/logout-button";
import { FormMessage } from "@/components/auth/form-parts";
import { PageLoading } from "@/components/layout/page-loading";
import { getCurrentProfile } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account unavailable" };

// Shown when a signed-in user has no usable profile or is suspended.
async function AccountStatusPage() {
  const lookup = await getCurrentProfile();
  if (lookup.kind === "signed-out") redirect("/login");
  if (lookup.kind === "found" && lookup.profile.accountStatus === "active") {
    redirect("/dashboard");
  }

  const suspended = lookup.kind === "found";

  return (
    <AuthCard title={suspended ? "Account suspended" : "Account unavailable"}>
      <div className="grid gap-4">
        <FormMessage
          status="error"
          message={
            suspended
              ? "This account has been suspended, so its dashboard and data are not available. Your records are kept. If you have a rental, return or deposit still in progress, BorrowNest support will help settle it. Contact support if you think this is a mistake."
              : "We could not load the profile for this account. Please try again later or contact BorrowNest support."
          }
        />
        <LogoutButton className="justify-self-start" />
      </div>
    </AuthCard>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <AccountStatusPage />
    </Suspense>
  );
}
