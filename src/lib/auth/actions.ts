"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { getSafeRedirectPath } from "@/lib/auth/redirects";
import {
  RECOVERY_COOKIE,
  getRecoveryUserId,
  requireActiveProfile,
} from "@/lib/auth/session";
import { getSiteUrl } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  formFields,
  loginSchema,
  resetPasswordSchema,
  signUpSchema,
  toFieldErrors,
  updateNameSchema,
  type FieldErrors,
} from "@/lib/validation/auth";

export interface FormState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: FieldErrors;
  /** Non-sensitive values echoed back so the form keeps them. Never passwords. */
  values?: Record<string, string>;
}

const NOT_CONFIGURED: FormState = {
  status: "error",
  message: "Accounts are not available yet because Supabase is not configured.",
};

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

// Only the error code is logged: never emails, passwords, or tokens.
function logAuthError(action: string, error: { code?: string; status?: number }) {
  console.error(`Auth action failed: ${action}`, { code: error.code, status: error.status });
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const fields = formFields(formData, ["fullName", "email", "password", "accountType"]);
  const values = { fullName: fields.fullName, email: fields.email, accountType: fields.accountType };

  const parsed = signUpSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };
  }

  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;

  const { fullName, email, password, accountType } = parsed.data;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Untrusted metadata: the database trigger allowlists account_type.
      data: { full_name: fullName, account_type: accountType },
      emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=/dashboard`,
    },
  });

  if (error) {
    if (error.code === "weak_password") {
      return { status: "error", fieldErrors: { password: "Choose a stronger password." }, values };
    }
    if (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
      return { status: "error", message: "Too many attempts. Please wait a few minutes.", values };
    }
    if (error.code !== "user_already_exists") {
      logAuthError("signup", error);
      return { status: "error", message: GENERIC_ERROR, values };
    }
  }

  // Projects without email confirmation return a session immediately.
  if (data.session) redirect("/dashboard");

  // Same response whether or not the email was already registered.
  return {
    status: "success",
    message: "Check your email for a confirmation link to finish creating your account.",
  };
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const fields = formFields(formData, ["email", "password", "next"]);
  const values = { email: fields.email };

  const parsed = loginSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };
  }

  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { status: "error", message: "Confirm your email address before logging in.", values };
    }
    if (error.code === "over_request_rate_limit") {
      return { status: "error", message: "Too many attempts. Please wait a few minutes.", values };
    }
    if (error.code !== "invalid_credentials") logAuthError("login", error);
    return { status: "error", message: "Incorrect email or password.", values };
  }

  redirect(getSafeRedirectPath(fields.next) ?? "/dashboard");
}

export async function forgotPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const fields = formFields(formData, ["email"]);
  const parsed = forgotPasswordSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: fields };
  }

  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getSiteUrl()}/auth/confirm?next=/reset-password`,
  });
  if (error) logAuthError("forgot-password", error);

  // Identical message whether or not the address has an account.
  return {
    status: "success",
    message: "If an account exists for that email, we have sent a link to reset the password.",
  };
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;

  // Re-verify the recovery session here; the page check is not enough.
  const userId = await getRecoveryUserId();
  if (!userId) {
    return {
      status: "error",
      message: "This reset link has expired. Request a new one to continue.",
    };
  }

  const parsed = resetPasswordSchema.safeParse(
    formFields(formData, ["password", "confirmPassword"]),
  );
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") {
      return { status: "error", fieldErrors: { password: "Choose a password you have not used here before." } };
    }
    if (error.code === "weak_password") {
      return { status: "error", fieldErrors: { password: "Choose a stronger password." } };
    }
    logAuthError("reset-password", error);
    return { status: "error", message: GENERIC_ERROR };
  }

  (await cookies()).delete(RECOVERY_COOKIE);
  redirect("/account?notice=password-updated");
}

export async function updateNameAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireActiveProfile("/account");

  const fields = formFields(formData, ["fullName"]);
  const parsed = updateNameSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: fields };
  }

  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;

  // Only full_name is writable for users (column privilege + RLS).
  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", profile.id)
    .select("id");

  if (error || data.length !== 1) {
    if (error) console.error("Profile update failed", { code: error.code });
    return { status: "error", message: "Your name could not be updated.", values: fields };
  }

  refresh();
  return { status: "success", message: "Your name has been updated.", values: { fullName: parsed.data.fullName } };
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  if (supabase) {
    // Revokes this session's refresh token and clears the auth cookies.
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) logAuthError("logout", error);
  }
  (await cookies()).delete(RECOVERY_COOKIE);
  redirect("/");
}
