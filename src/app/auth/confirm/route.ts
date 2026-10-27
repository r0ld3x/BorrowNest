import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getSafeRedirectPath } from "@/lib/auth/redirects";
import { RECOVERY_COOKIE } from "@/lib/auth/session";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

const ALLOWED_OTP_TYPES: ReadonlySet<string> = new Set<EmailOtpType>([
  "signup",
  "email",
  "recovery",
]);

/**
 * Email confirmation and password-recovery landing route.
 * Supports the token_hash links recommended for SSR, and the PKCE ?code=
 * links produced by the default email templates.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const config = getSupabaseConfig();
  if (!config) return redirectTo(request, "/login");

  const pendingCookies: Parameters<NextResponse["cookies"]["set"]>[] = [];
  const supabase = createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          pendingCookies.push([name, value, options]);
        }
      },
    },
  });

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  let userId: string | undefined;
  let isRecovery = false;

  if (tokenHash && type && ALLOWED_OTP_TYPES.has(type)) {
    const { data, error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    if (!error) userId = data.user?.id;
    isRecovery = type === "recovery";
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) userId = data.user?.id;
    isRecovery = next === "/reset-password";
  }

  if (!userId) {
    return redirectTo(request, "/login?error=link-invalid", pendingCookies);
  }

  const response = redirectTo(
    request,
    isRecovery ? "/reset-password" : (getSafeRedirectPath(next) ?? "/dashboard"),
    pendingCookies,
  );

  if (isRecovery) {
    response.cookies.set(RECOVERY_COOKIE, userId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 15 * 60,
    });
  }
  return response;
}

function redirectTo(
  request: NextRequest,
  path: string,
  cookiesToSet: Parameters<NextResponse["cookies"]["set"]>[] = [],
) {
  // Path is always an internal constant or allowlisted value.
  const response = NextResponse.redirect(new URL(path, request.nextUrl.origin));
  for (const args of cookiesToSet) response.cookies.set(...args);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
