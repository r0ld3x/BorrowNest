import { HouseIcon, MapPinIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { MobileNavigation } from "@/components/layout/mobile-navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { getVerifiedClaims } from "@/lib/auth/session";
import {
  ACCOUNT_NAV_LINKS,
  PRIMARY_NAV_LINKS,
  SERVICE_CITY,
  SITE_NAME,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

const NAV_LINK_CLASS =
  "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
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
              <li key={link.href} className={link.wideOnly ? "hidden lg:block" : undefined}>
                <Link href={link.href} className={NAV_LINK_CLASS}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Session-dependent UI streams in; the rest of the page stays static. */}
        <Suspense fallback={<div aria-hidden="true" className="hidden h-9 w-44 md:block" />}>
          <DesktopAccountLinks />
        </Suspense>

        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <ThemeToggle />
          <Suspense fallback={<MobileNavigation />}>
            <MobileNavigationWithSession />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function DesktopAccountLinks() {
  const signedIn = Boolean(await getVerifiedClaims());

  if (!signedIn) {
    return (
      <div className="hidden items-center gap-1 md:flex">
        <Link href="/login" className={NAV_LINK_CLASS}>
          Log in
        </Link>
        <Link href="/signup" className={cn(buttonVariants(), "h-9 px-3.5")}>
          Create account
        </Link>
      </div>
    );
  }

  return (
    <div className="hidden items-center gap-1 md:flex">
      {ACCOUNT_NAV_LINKS.map((link) => (
        <Link key={link.href} href={link.href} className={NAV_LINK_CLASS}>
          {link.label}
        </Link>
      ))}
      <LogoutButton className="text-muted-foreground" />
    </div>
  );
}

async function MobileNavigationWithSession() {
  const signedIn = Boolean(await getVerifiedClaims());
  return <MobileNavigation signedIn={signedIn} />;
}
