import "server-only";

import { productPhotoUrl } from "@/lib/listings/queries";
import { createClient } from "@/lib/supabase/server";
import type { AccountStatus, AuditAction, ListingStatus, UserRole } from "@/types/database";

// Every read below runs under the admin's own session: the admin_* functions
// and RLS policies check for an active admin in the database.

export const ADMIN_PAGE_SIZE = 20;

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
}

function toPage<T>(rows: (T & { total_count: number })[], page: number): Page<T> {
  const total = rows[0]?.total_count ?? 0;
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)) };
}

const offsetFor = (page: number) => (page - 1) * ADMIN_PAGE_SIZE;

export async function getAdminOverview() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_overview");
  if (error) {
    console.error("Admin overview failed", { code: error.code });
    return null;
  }
  return data[0] ?? null;
}

export async function listListingsForAdmin(status: ListingStatus | null, search: string, page: number) {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_list_listings", {
    p_status: status,
    p_search: search,
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: offsetFor(page),
  });
  if (error) {
    console.error("Admin listings query failed", { code: error.code });
    return null;
  }
  return toPage(
    data.map((row) => ({ ...row, coverUrl: row.cover_path ? productPhotoUrl(row.cover_path) : null })),
    page,
  );
}

export interface AdminAccountRow {
  id: string;
  full_name: string;
  email: string | null;
  role: UserRole;
  account_status: AccountStatus;
  created_at: string;
  listing_count: number;
}

export async function listAccountsForAdmin(search: string, page: number): Promise<Page<AdminAccountRow> | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_list_accounts", {
    p_search: search,
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: offsetFor(page),
  });
  if (error) {
    console.error("Admin accounts query failed", { code: error.code });
    return null;
  }
  return toPage(data, page);
}

export interface AuditEntry {
  id: string;
  action: AuditAction;
  target_type: "product" | "profile";
  target_id: string;
  reason: string | null;
  summary: Record<string, unknown>;
  created_at: string;
  actor_name: string | null;
}

export async function listAuditForAdmin(targetId: string | null, page: number, pageSize = ADMIN_PAGE_SIZE) {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_list_audit", {
    p_target_id: targetId,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) {
    console.error("Admin audit query failed", { code: error.code });
    return null;
  }
  return toPage<AuditEntry>(data, page);
}

/** Full review context for one listing, including private pickup details. */
export async function getListingForReview(productId: string) {
  const supabase = await createClient();
  if (!supabase) return null;

  const [product, pickup, images] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, provider_id, title, description, category, condition, price_per_day, deposit, city, area, landmark, listing_status, moderation_reason, moderated_at, created_at, updated_at",
      )
      .eq("id", productId)
      .maybeSingle(),
    supabase.from("product_pickup_details").select("exact_address, pickup_instructions").eq("product_id", productId).maybeSingle(),
    supabase.from("product_images").select("id, storage_path, sort_order, caption").eq("product_id", productId).order("sort_order"),
  ]);

  if (product.error || pickup.error || images.error) {
    console.error("Admin listing review query failed", {
      code: product.error?.code ?? pickup.error?.code ?? images.error?.code,
    });
    return null;
  }
  if (!product.data) return null;

  const provider = await supabase
    .from("profiles")
    .select("id, full_name, role, account_status, created_at")
    .eq("id", product.data.provider_id)
    .maybeSingle();

  return {
    product: product.data,
    pickup: pickup.data,
    provider: provider.data,
    images: (images.data ?? []).flatMap((image) => {
      const url = productPhotoUrl(image.storage_path);
      return url ? [{ id: image.id, url, caption: image.caption }] : [];
    }),
  };
}
