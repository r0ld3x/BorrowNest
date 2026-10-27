"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

/**
 * Browser client using the publishable key and the user's session cookies.
 * Authorization is enforced by RLS; nothing here is trusted by the server.
 */
export function createClient() {
  const config = getSupabaseConfig();
  if (!config) return null;
  return createBrowserClient<Database>(config.url, config.publishableKey);
}
