import "server-only";

import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { ListingStatus } from "@/types/database";

export const PRODUCT_PHOTOS_BUCKET = "product-photos";

export interface OwnListingSummary {
  id: string;
  title: string;
  status: ListingStatus;
  pricePerDay: number;
  area: string;
  updatedAt: string;
  coverUrl: string | null;
}

export interface OwnListingImage {
  id: string;
  url: string;
  caption: string | null;
  sortOrder: number;
}

export interface OwnListing {
  id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  pricePerDay: string;
  deposit: string;
  area: string;
  landmark: string;
  status: ListingStatus;
  moderationReason: string | null;
  exactAddress: string;
  pickupInstructions: string;
  images: OwnListingImage[];
}

/** Public object URL. Photos are intentionally public (see the storage migration). */
export function productPhotoUrl(storagePath: string): string | null {
  const config = getSupabaseConfig();
  if (!config) return null;
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${config.url}/storage/v1/object/public/${PRODUCT_PHOTOS_BUCKET}/${encoded}`;
}

function rupeeString(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Listings owned by the signed-in provider. RLS returns only their rows. */
export async function getOwnListings(): Promise<OwnListingSummary[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("products")
    .select("id, title, listing_status, price_per_day, area, updated_at, product_images(storage_path, sort_order)")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Own listings query failed", { code: error.code });
    return null;
  }

  return data.map((row) => {
    const cover = [...(row.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0];
    return {
      id: row.id,
      title: row.title,
      status: row.listing_status,
      pricePerDay: row.price_per_day,
      area: row.area,
      updatedAt: row.updated_at,
      coverUrl: cover ? productPhotoUrl(cover.storage_path) : null,
    };
  });
}

/** One listing owned by the signed-in provider, or null (missing or not theirs). */
export async function getOwnListing(productId: string): Promise<OwnListing | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const [product, pickup, images] = await Promise.all([
    supabase
      .from("products")
      .select("id, title, description, category, condition, price_per_day, deposit, area, landmark, listing_status, moderation_reason")
      .eq("id", productId)
      .maybeSingle(),
    supabase
      .from("product_pickup_details")
      .select("exact_address, pickup_instructions")
      .eq("product_id", productId)
      .maybeSingle(),
    supabase
      .from("product_images")
      .select("id, storage_path, sort_order, caption")
      .eq("product_id", productId)
      .order("sort_order"),
  ]);

  if (product.error || pickup.error || images.error) {
    console.error("Own listing query failed", {
      code: product.error?.code ?? pickup.error?.code ?? images.error?.code,
    });
    return null;
  }
  if (!product.data) return null;

  const p = product.data;
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    category: p.category,
    condition: p.condition,
    pricePerDay: rupeeString(p.price_per_day),
    deposit: rupeeString(p.deposit),
    area: p.area,
    landmark: p.landmark,
    status: p.listing_status,
    moderationReason: p.listing_status === "rejected" ? p.moderation_reason : null,
    exactAddress: pickup.data?.exact_address ?? "",
    pickupInstructions: pickup.data?.pickup_instructions ?? "",
    images: (images.data ?? []).flatMap((image) => {
      const url = productPhotoUrl(image.storage_path);
      return url ? [{ id: image.id, url, caption: image.caption, sortOrder: image.sort_order }] : [];
    }),
  };
}
