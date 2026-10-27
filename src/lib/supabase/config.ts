// Public Supabase settings. Only the URL and publishable key are read here;
// both are safe to ship to browsers. Privileged keys must never be added.

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

function parseHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

/** Returns null when Supabase is not configured, so callers can degrade. */
export function getSupabaseConfig(): SupabaseConfig | null {
  // Referenced directly so Next.js can inline them at build time.
  const url = parseHttpUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

/** Origin used to build email links. Falls back to local development. */
export function getSiteUrl(): string {
  return parseHttpUrl(process.env.NEXT_PUBLIC_SITE_URL) ?? "http://localhost:3000";
}
