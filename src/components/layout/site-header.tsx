import { HouseIcon, MapPinIcon } from "lucide-react";
import Link from "next/link";

import { MobileNavigation } from "@/components/layout/mobile-navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { PRIMARY_NAV_LINKS, SERVICE_CITY, SITE_NAME } from "@/lib/constants";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
          >
            <HouseIcon className="size-4.5" />
          </span>
          <span className="text-lg">{SITE_NAME}</span>
        </Link>

        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <MapPinIcon aria-hidden="true" className="size-3.5 text-primary" />
          <span className="sr-only">Service area: </span>
          {SERVICE_CITY}
        </span>

        <nav aria-label="Primary" className="ml-auto hidden md:block">
          <ul className="flex items-center gap-1">
            {PRIMARY_NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1 md:ml-2">
          <ThemeToggle />
          <MobileNavigation />
        </div>
      </div>
    </header>
  );
}
