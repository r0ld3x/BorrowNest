import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { dashboardPathFor, getSafeRedirectPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";
import type { AccountStatus, UserRole } from "@/types/database";

/** The minimum profile data the app needs. Safe to pass to the browser. */
export interface CurrentProfile {
  id: string;
  fullName: string;
  role: UserRole;
  accountStatus: AccountStatus;
}

export type ProfileLookup =
  | { kind: "signed-out" }
  | { kind: "unavailable"; userId: string }
  | { kind: "found"; profile: CurrentProfile };

export const RECOVERY_COOKIE = "bn_recovery";
const RECOVERY_WINDOW_SECONDS = 60 * 60;

/**
 * Verified identity for this request. getClaims() validates the JWT
 * signature and expiry; the cookie contents are never trusted directly.
 * Memoized per request only, never across users.
 */
export const getVerifiedClaims = cache(async () => {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims;
});

/**
 * Loads the caller's current profile from the database (through RLS), which
 * is the only source of role and account status. JWT and user metadata
 * claims are never used for authorization.
 */
export const getCurrentProfile = cache(async (): Promise<ProfileLookup> => {
  const claims = await getVerifiedClaims();
  if (!claims) return { kind: "signed-out" };

  const supabase = await createClient();
  if (!supabase) return { kind: "signed-out" };

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, account_status")
    .eq("id", claims.sub)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("Profile lookup failed", { code: error.code });
    return { kind: "unavailable", userId: claims.sub };
  }

  return {
    kind: "found",
    profile: {
      id: data.id,
      fullName: data.full_name,
      role: data.role,
      accountStatus: data.account_status,
    },
  };
});

function loginRedirect(next?: string): never {
  const safeNext = getSafeRedirectPath(next);
  redirect(safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login");
}

/** Requires a verified signed-in user. Returns their user id. */
export async function requireUser(next?: string): Promise<string> {
  const claims = await getVerifiedClaims();
  if (!claims) loginRedirect(next);
  return claims.sub;
}

/** Requires a signed-in user with an existing, active profile. */
export async function requireActiveProfile(next?: string): Promise<CurrentProfile> {
  const lookup = await getCurrentProfile();
  if (lookup.kind === "signed-out") loginRedirect(next);
  if (lookup.kind === "unavailable" || lookup.profile.accountStatus !== "active") {
    redirect("/account-status");
  }
  return lookup.profile;
}

/** Requires an active profile whose current database role is allowed. */
export async function requireRole(
  allowedRoles: readonly UserRole[],
  next?: string,
): Promise<CurrentProfile> {
  const profile = await requireActiveProfile(next);
  if (!allowedRoles.includes(profile.role)) {
    redirect(dashboardPathFor(profile.role));
  }
  return profile;
}

/**
 * Whether the current session came from a password-recovery link: either
 * the JWT records a recent "recovery" sign-in, or /auth/confirm marked this
 * user's recovery verification with an HttpOnly cookie bound to their id.
 */
export async function getRecoveryUserId(): Promise<string | null> {
  const claims = await getVerifiedClaims();
  if (!claims) return null;

  const now = Math.floor(Date.now() / 1000);
  const amr = Array.isArray(claims.amr) ? claims.amr : [];
  const recentRecovery = amr.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "method" in entry &&
      entry.method === "recovery" &&
      typeof entry.timestamp === "number" &&
      now - entry.timestamp < RECOVERY_WINDOW_SECONDS,
  );
  if (recentRecovery) return claims.sub;

  const marker = (await cookies()).get(RECOVERY_COOKIE)?.value;
  return marker === claims.sub ? claims.sub : null;
}
