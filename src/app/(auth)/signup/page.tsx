import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard, SetupNotice } from "@/components/auth/auth-card";
import { SignUpForm } from "@/components/auth/auth-forms";
import { getVerifiedClaims } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  const configured = isSupabaseConfigured();
  if (configured && (await getVerifiedClaims())) redirect("/dashboard");

  return (
    <AuthCard
      title="Create your account"
      description="Rent essentials or list your own items in Gwalior."
      footer={
        configured ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
              Log in
            </Link>
          </>
        ) : null
      }
    >
      {configured ? <SignUpForm /> : <SetupNotice />}
    </AuthCard>
  );
}
