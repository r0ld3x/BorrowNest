import { LISTING_STATUS_LABELS } from "@/lib/listings/options";
import { cn } from "@/lib/utils";
import type { ListingStatus } from "@/types/database";

// The label is always shown; color only reinforces it.
const STATUS_STYLES: Record<ListingStatus, string> = {
  draft: "border-border bg-muted text-foreground",
  pending_review: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  published: "border-primary/40 bg-accent text-accent-foreground",
  paused: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  rejected: "border-destructive/40 bg-destructive/10 text-destructive",
  archived: "border-border bg-muted text-muted-foreground",
};

export function ListingStatusBadge({ status, className }: { status: ListingStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-xs font-medium",
        STATUS_STYLES[status],
        className,
      )}
    >
      {LISTING_STATUS_LABELS[status]}
    </span>
  );
}
