// Browser-safe listing vocabularies. Values mirror the database checks in
// supabase/migrations; labels are display text only.

import type { ListingStatus } from "@/types/database";

export const PRODUCT_CATEGORIES = [
  { value: "furniture", label: "Furniture" },
  { value: "appliances", label: "Appliances" },
  { value: "bicycles", label: "Bicycles" },
  { value: "study_essentials", label: "Study essentials" },
  { value: "kitchen", label: "Kitchen" },
  { value: "other", label: "Other" },
] as const;

export const PRODUCT_CONDITIONS = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]["value"];
export type ProductCondition = (typeof PRODUCT_CONDITIONS)[number]["value"];

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  published: "Published",
  paused: "Paused",
  rejected: "Rejected",
  archived: "Archived",
};

export const MAX_PRODUCT_IMAGES = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function labelFor<T extends string>(
  options: readonly { value: T; label: string }[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
