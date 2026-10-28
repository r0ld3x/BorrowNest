"use client";

import { SlidersHorizontalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** Mobile wrapper for the server-rendered filter form (passed as children). */
export function MobileFilterSheet({ activeCount, children }: { activeCount: number; children: React.ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button type="button" variant="outline" className="h-10 lg:hidden" />}>
        <SlidersHorizontalIcon aria-hidden="true" data-icon="inline-start" />
        Filters{activeCount > 0 ? ` (${activeCount})` : ""}
      </SheetTrigger>
      <SheetContent side="left" className="w-[min(22rem,90vw)] overflow-y-auto">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Narrow down listings in Gwalior.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
