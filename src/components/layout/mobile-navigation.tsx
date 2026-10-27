"use client";

import { LogOutIcon, MapPinIcon, MenuIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { logoutAction } from "@/lib/auth/actions";
import { ACCOUNT_NAV_LINKS, GUEST_NAV_LINKS, PRIMARY_NAV_LINKS, SERVICE_CITY } from "@/lib/constants";

const LINK_CLASS =
  "block w-full rounded-lg px-3 py-2.5 text-left text-base font-medium transition-colors hover:bg-muted";

/**
 * `signedIn` only chooses which links to show. It is not an authorization
 * signal: every protected page and action checks the session itself.
 * Undefined means the session is still being resolved.
 */
export function MobileNavigation({ signedIn }: { signedIn?: boolean }) {
  const [open, setOpen] = useState(false);
  const accountLinks = signedIn === undefined ? [] : signedIn ? ACCOUNT_NAV_LINKS : GUEST_NAV_LINKS;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation menu"
            className="size-9 md:hidden"
          />
        }
      >
        <MenuIcon aria-hidden="true" className="size-5" />
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(20rem,85vw)]">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription className="flex items-center gap-1.5">
            <MapPinIcon aria-hidden="true" className="size-3.5" />
            Serving {SERVICE_CITY} only
          </SheetDescription>
        </SheetHeader>
        <nav aria-label="Mobile" className="px-2">
          <ul className="flex flex-col gap-1">
            {PRIMARY_NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} onClick={() => setOpen(false)} className={LINK_CLASS}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          {accountLinks.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
              {accountLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} onClick={() => setOpen(false)} className={LINK_CLASS}>
                    {link.label}
                  </Link>
                </li>
              ))}
              {signedIn ? (
                <li>
                  <form action={logoutAction}>
                    <button type="submit" className={`${LINK_CLASS} flex items-center gap-2`}>
                      <LogOutIcon aria-hidden="true" className="size-4" />
                      Log out
                    </button>
                  </form>
                </li>
              ) : null}
            </ul>
          ) : null}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
