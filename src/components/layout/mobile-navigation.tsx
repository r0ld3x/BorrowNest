"use client";

import { MapPinIcon, MenuIcon } from "lucide-react";
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
import { PRIMARY_NAV_LINKS, SERVICE_CITY } from "@/lib/constants";

export function MobileNavigation() {
  const [open, setOpen] = useState(false);

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
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-base font-medium transition-colors hover:bg-muted"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
