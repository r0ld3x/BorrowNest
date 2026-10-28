import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthCard, SetupNotice } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { FormMessage } from "@/components/auth/form-parts";
import { PageLoading } from "@/components/layout/page-loading";
import { buttonVariants } from "@/components/ui/button";
import { getRecoveryUserId } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Choose a new password" };

async function ResetPasswordPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AuthCard title="Choose a new password">
        <SetupNotice />
      </AuthCard>
    );
  }

  const recoveryUserId = await getRecoveryUserId();

  return (
    <AuthCard title="Choose a new password">
      {recoveryUserId ? (
        <ResetPasswordForm />
      ) : (
        <div className="grid gap-4">
          <FormMessage
            status="error"
            message="Open the reset link from your email to choose a new password. Links expire after a short time."
          />
          <Link href="/forgot-password" className={buttonVariants({ variant: "outline", className: "h-10" })}>
            Request a new link
          </Link>
        </div>
      )}
    </AuthCard>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ResetPasswordPage />
    </Suspense>
  );
}
