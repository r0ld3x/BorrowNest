// Browser-safe parsing of untrusted admin list query parameters.
import type { ListingStatus } from "@/types/database";

const LISTING_STATUSES: readonly ListingStatus[] = [
  "pending_review",
  "published",
  "rejected",
  "paused",
  "draft",
  "archived",
];

type Param = string | string[] | undefined;

export function parsePage(value: Param): number {
  if (typeof value !== "string" || !/^\d{1,4}$/.test(value)) return 1;
  return Math.min(Math.max(Number(value), 1), 500);
}

/** Trimmed, length-bounded search text; the database escapes LIKE wildcards. */
export function parseSearch(value: Param): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

/** "all" means no filter; anything unknown falls back to the review queue. */
export function parseListingStatus(value: Param): ListingStatus | "all" {
  if (value === "all") return "all";
  return typeof value === "string" && (LISTING_STATUSES as readonly string[]).includes(value)
    ? (value as ListingStatus)
    : "pending_review";
}

export { LISTING_STATUSES };
