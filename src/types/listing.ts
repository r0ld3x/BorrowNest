import type { ListingCategorySlug } from "@/lib/constants";

/**
 * Public catalogue fields only. Pickup details, moderation fields, provider
 * ids and contact details are deliberately not part of these types.
 */
export interface PublicListingSummary {
  id: string;
  title: string;
  category: ListingCategorySlug;
  condition: string;
  area: string;
  landmark: string;
  /** Whole or 2-decimal rupees per day. */
  pricePerDay: number;
  /** Refundable deposit in rupees. */
  deposit: number;
  coverUrl: string | null;
  imageCount: number;
  listedBy: string | null;
}

export interface PublicListingImage {
  id: string;
  url: string;
  caption: string | null;
}

export interface PublicListingDetail extends PublicListingSummary {
  description: string;
  city: string;
  images: PublicListingImage[];
}
