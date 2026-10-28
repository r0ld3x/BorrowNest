import Link from "next/link";

import { ROLE_LABELS, dashboardPathFor } from "@/lib/auth/redirects";
import type { CurrentProfile } from "@/lib/auth/session";

const ROLE_LINKS = {
  renter: [{ href: "/listings", label: "Browse listings" }],
  provider: [{ href: "/provider/listings", label: "Listings" }],
  admin: [
    { href: "/admin/listings", label: "Listings" },
    { href: "/admin/users", label: "Accounts" },
    { href: "/admin/activity", label: "Activity" },
  ],
} as const;

export function DashboardShell({
  profile,
  title,
  children,
}: {
  profile: Pick<CurrentProfile, "fullName" | "role">;
  title: string;
  children: React.ReactNode;
}) {
  const links = [
    { href: dashboardPathFor(profile.role), label: "Overview" },
    ...ROLE_LINKS[profile.role],
    { href: "/account", label: "Account" },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-primary">{ROLE_LABELS[profile.role]}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 wrap-break-word text-muted-foreground">
            Signed in as {profile.fullName}
          </p>
        </div>
      </div>
      <nav aria-label="Dashboard" className="mt-6 border-b border-border">
        <ul className="-mb-px flex flex-wrap gap-1">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex h-10 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-8">{children}</div>
    </div>
  );
}

export function UpcomingPanel({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <section aria-labelledby="upcoming-heading" className="rounded-xl border border-border bg-card p-6">
      <h2 id="upcoming-heading" className="font-semibold">
        {title}
      </h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
