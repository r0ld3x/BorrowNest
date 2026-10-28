import type { NextConfig } from "next";

// The only remote images allowed: this project's public product-photos
// bucket. No host wildcards.
function productPhotoPattern(): URL | null {
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
    return new URL(`${origin}/storage/v1/object/public/product-photos/**`);
  } catch {
    return null;
  }
}

const photoPattern = productPhotoPattern();

// The public host the app is served from when it is not localhost (for
// example an HTTPS tunnel). Exact hostname only, never a wildcard.
function publicSiteHost(): string | null {
  try {
    const { hostname } = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
    return hostname && hostname !== "localhost" && hostname !== "127.0.0.1" ? hostname : null;
  } catch {
    return null;
  }
}

const siteHost = publicSiteHost();

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  images: {
    remotePatterns: photoPattern ? [photoPattern] : [],
  },
  // Lets the dev server answer requests coming through the public host.
  allowedDevOrigins: siteHost ? [siteHost] : [],
  experimental: {
    serverActions: {
      // One photo (5 MB max) per upload action, plus form overhead.
      bodySizeLimit: "6mb",
      // Same-origin CSRF check also accepts the public host, in case the
      // tunnel forwards a different Host header than the browser's origin.
      allowedOrigins: siteHost ? [siteHost] : [],
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
