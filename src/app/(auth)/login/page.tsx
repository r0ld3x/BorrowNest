import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard, SetupNotice } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/auth-forms";
import { FormMessage } from "@/components/auth/form-parts";
import { getSafeRedirectPath } from "@/lib/auth/redirects";
import { getVerifiedClaims } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Log in" };

// Fixed messages keyed by allowlisted codes; query values are never echoed.
const NOTICES = {
  "link-invalid": {
    status: "error",
    message: "That link is invalid or has expired. Please try again.",
  },
} as const;

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const configured = isSupabaseConfigured();

  if (configured && (await getVerifiedClaims())) {
    redirect(getSafeRedirectPath(next) ?? "/dashboard");
  }

  const notice = typeof error === "string" && error in NOTICES
    ? NOTICES[error as keyof typeof NOTICES]
    : null;

  return (
    <AuthCard
      title="Log in"
      description="Welcome back to BorrowNest."
      footer={
        configured ? (
          <>
            New here?{" "}
            <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
              Create an account
            </Link>
          </>
        ) : null
      }
    >
      {configured ? (
        <div className="grid gap-4">
          {notice ? <FormMessage status={notice.status} message={notice.message} /> : null}
          <LoginForm next={getSafeRedirectPath(next)} />
          <Link
            href="/forgot-password"
            className="justify-self-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Forgot your password?
          </Link>
        </div>
      ) : (
        <SetupNotice />
      )}
    </AuthCard>
  );
}
