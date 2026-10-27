import type { ListingCategorySlug } from "@/lib/constants";

export interface ListingImage {
  src: string;
  alt: string;
}

/**
 * Public listing fields only. The exact pickup address is private and is
 * deliberately not part of this type.
 */
export interface Listing {
  id: string;
  title: string;
  category: ListingCategorySlug;
  city: "Gwalior";
  area: string;
  landmark: string;
  /** Whole rupees per day. */
  dailyRate: number;
  /** Whole rupees, refundable. */
  refundableDeposit: number;
  coverImage: ListingImage;
  featured: boolean;
}
