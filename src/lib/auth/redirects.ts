// Browser-safe redirect rules. Post-login destinations come from a strict
// allowlist of internal paths, so a crafted ?next= value can never send a
// user to another origin (including protocol-relative //evil.example).

import type { UserRole } from "@/types/database";

const POST_LOGIN_DESTINATIONS = new Set([
  "/dashboard",
  "/account",
  "/renter",
  "/provider",
  "/admin",
]);

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/account",
  "/account-status",
  "/renter",
  "/provider",
  "/admin",
] as const;

/** Returns the value only if it exactly matches an allowlisted path. */
export function getSafeRedirectPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return POST_LOGIN_DESTINATIONS.has(value) ? value : null;
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function dashboardPathFor(role: UserRole): "/renter" | "/provider" | "/admin" {
  switch (role) {
    case "admin":
      return "/admin";
    case "provider":
      return "/provider";
    default:
      return "/renter";
  }
}

export const ROLE_LABELS: Record<UserRole, string> = {
  renter: "Renter",
  provider: "Provider",
  admin: "Admin",
};
