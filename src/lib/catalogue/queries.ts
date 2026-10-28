import "server-only";

import { CATALOGUE_PAGE_SIZE, type CatalogueFilters } from "@/lib/catalogue/params";
import { isListingCategorySlug } from "@/lib/constants";
import { productPhotoUrl } from "@/lib/listings/queries";
import { createClient } from "@/lib/supabase/server";
import type { PublicListingDetail, PublicListingSummary } from "@/types/listing";

// Public catalogue reads go through the explicit-column database functions
// only (never the base tables), so private fields cannot appear in results,
// page props, or the RSC payload. Results are not cached: a suspension or
// unpublish disappears on the next request.

export interface CatalogueResult {
  rows: PublicListingSummary[];
  total: number;
  page: number;
  pageCount: number;
}

export async function searchCatalogue(filters: CatalogueFilters, pageSize = CATALOGUE_PAGE_SIZE): Promise<CatalogueResult | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("search_published_products", {
    p_query: filters.q,
    p_category: filters.category,
    p_area: filters.area,
    p_min_price: filters.min,
    p_max_price: filters.max,
    p_sort: filters.sort,
    p_limit: pageSize,
    p_offset: (filters.page - 1) * pageSize,
  });
  if (error) {
    console.error("Catalogue search failed", { code: error.code });
    return null;
  }

  const total = data[0]?.total_count ?? 0;
  return {
    rows: data.flatMap((row) =>
      isListingCategorySlug(row.category)
        ? [
            {
              id: row.id,
              title: row.title,
              category: row.category,
              condition: row.condition,
              area: row.area,
              landmark: row.landmark,
              pricePerDay: row.price_per_day,
              deposit: row.deposit,
              coverUrl: row.cover_path ? productPhotoUrl(row.cover_path) : null,
              imageCount: row.image_count,
              listedBy: row.listed_by,
            },
          ]
        : [],
    ),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** A published listing from an active provider, or null (missing, unpublished, or hidden). */
export async function getPublicListing(productId: string): Promise<PublicListingDetail | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const [product, images] = await Promise.all([
    supabase.rpc("get_published_product", { p_product_id: productId }).maybeSingle(),
    supabase.rpc("get_published_product_images", { p_product_id: productId }),
  ]);
  if (product.error || images.error) {
    console.error("Catalogue detail failed", { code: product.error?.code ?? images.error?.code });
    return null;
  }
  const p = product.data;
  if (!p || !isListingCategorySlug(p.category)) return null;

  const gallery = (images.data ?? []).flatMap((image) => {
    const url = productPhotoUrl(image.storage_path);
    return url ? [{ id: image.id, url, caption: image.caption }] : [];
  });

  return {
    id: p.id,
    title: p.title,
    description: p.description,
    category: p.category,
    condition: p.condition,
    city: p.city,
    area: p.area,
    landmark: p.landmark,
    pricePerDay: p.price_per_day,
    deposit: p.deposit,
    listedBy: p.listed_by,
    coverUrl: gallery[0]?.url ?? null,
    imageCount: gallery.length,
    images: gallery,
  };
}

export async function getPublishedAreas(): Promise<{ area: string; count: number }[]> {
  const supabase = await createClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("published_areas");
  if (error) {
    console.error("Catalogue areas failed", { code: error.code });
    return [];
  }
  return data.map((row) => ({ area: row.area, count: row.listing_count }));
}
