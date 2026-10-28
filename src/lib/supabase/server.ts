import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

/**
 * Per-request server client: publishable key plus the caller's session
 * cookies, so every query runs under the user's RLS context. Returns null
 * when Supabase is not configured.
 */
export async function createClient() {
  const config = getSupabaseConfig();
  if (!config) return null;

  const cookieStore = await cookies();
  // Session-scoped work always runs at request time: it keeps per-user data
  // out of prerendered/prefetched shells, and supabase-js reads the clock
  // (session expiry) as soon as the client is created.
  await connection();

  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session on every request, so this write can be skipped.
        }
      },
    },
  });
}
