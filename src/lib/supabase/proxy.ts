import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSafeRedirectPath, isProtectedPath } from "@/lib/auth/redirects";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

/**
 * Refreshes the Supabase session cookies on every matched request, following
 * the official @supabase/ssr pattern, and sends signed-out visitors of
 * protected routes to /login.
 *
 * The redirect is a convenience only. Pages, Server Actions, and RLS each
 * authorize independently.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const config = getSupabaseConfig();
  if (!config) return response;

  const supabase = createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Responses that set auth cookies must never be cached.
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Must run before any response is produced so a refreshed token is saved.
  // getClaims() verifies the JWT; it does not trust the cookie contents.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims?.sub);

  const { pathname } = request.nextUrl;
  if (!isSignedIn && isProtectedPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    const next = getSafeRedirectPath(pathname);
    if (next) loginUrl.searchParams.set("next", next);

    // Carry refreshed or cleared cookies and no-cache headers over.
    const redirect = NextResponse.redirect(loginUrl);
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) redirect.headers.set(header, value);
    }
    return redirect;
  }

  return response;
}
