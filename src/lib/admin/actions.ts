"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { parseSearch } from "@/lib/admin/params";
import type { FormState } from "@/lib/auth/actions";
import { requireRole } from "@/lib/auth/session";
import { describeListingError, GENERIC_LISTING_ERROR } from "@/lib/listings/errors";
import { createClient } from "@/lib/supabase/server";
import { formFields, toFieldErrors } from "@/lib/validation/auth";
import { listingSchema, uuidSchema } from "@/lib/validation/listing";

const reason = (min: number) =>
  z
    .string()
    .transform((value) => value.replace(/[\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(min, `Enter a reason of at least ${min} characters.`)
        .max(500, "Keep the reason to 500 characters or fewer."),
    );

const moderationSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), reason: reason(0) }),
  z.object({ decision: z.literal("reject"), reason: reason(10) }),
]);

// The version the admin reviewed; the database refuses stale decisions.
const versionSchema = z.iso.datetime({ offset: true });

function logAdminError(operation: string, error: { code?: string; message?: string }) {
  const bnCode = error.message?.match(/BN:([a-z_]+)/)?.[1];
  console.error(`Admin operation failed: ${operation}`, { code: error.code, bnCode });
}

export async function moderateListingAction(
  productId: string,
  version: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireRole(["admin"]);

  const id = uuidSchema.safeParse(productId);
  const expected = versionSchema.safeParse(version);
  if (!id.success || !expected.success) return { status: "error", message: GENERIC_LISTING_ERROR };

  const fields = formFields(formData, ["decision", "reason"]);
  const parsed = moderationSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: { reason: fields.reason } };
  }

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: GENERIC_LISTING_ERROR };

  const { data: status, error } = await supabase.rpc("moderate_listing", {
    p_product_id: id.data,
    p_decision: parsed.data.decision,
    p_reason: parsed.data.reason,
    p_expected_updated_at: expected.data,
  });
  if (error) {
    logAdminError("moderate", error);
    return { status: "error", message: describeListingError(error).message, values: { reason: fields.reason } };
  }

  // Reload the page with a fixed notice so the forms show the new version.
  redirect(`/admin/listings/${id.data}?notice=${status === "published" ? "approved" : "rejected"}`);
}

const ADMIN_EDIT_FIELDS = ["title", "description", "category", "condition", "area", "landmark", "reason"] as const;

const adminEditSchema = listingSchema
  .pick({ title: true, description: true, category: true, condition: true, area: true, landmark: true })
  .extend({ reason: reason(10) });

export async function adminEditListingAction(
  productId: string,
  version: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireRole(["admin"]);

  const id = uuidSchema.safeParse(productId);
  const expected = versionSchema.safeParse(version);
  const fields = formFields(formData, ADMIN_EDIT_FIELDS);
  if (!id.success || !expected.success) return { status: "error", message: GENERIC_LISTING_ERROR, values: fields };

  const parsed = adminEditSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", message: "Check the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values: fields };
  }

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: GENERIC_LISTING_ERROR, values: fields };

  const { error } = await supabase.rpc("admin_edit_listing", {
    p_product_id: id.data,
    p_expected_updated_at: expected.data,
    p_title: parsed.data.title,
    p_description: parsed.data.description,
    p_category: parsed.data.category,
    p_condition: parsed.data.condition,
    p_area: parsed.data.area,
    p_landmark: parsed.data.landmark,
    p_reason: parsed.data.reason,
  });
  if (error) {
    logAdminError("edit-listing", error);
    const described = describeListingError(error);
    return {
      status: "error",
      message: described.message,
      fieldErrors: described.field ? { [described.field.name]: described.field.message } : undefined,
      values: fields,
    };
  }

  redirect(`/admin/listings/${id.data}?notice=corrected`);
}

const accountStatusSchema = z.object({
  operation: z.enum(["suspend", "restore"]),
  reason: reason(10),
});

export async function setAccountStatusAction(
  profileId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireRole(["admin"]);

  const id = uuidSchema.safeParse(profileId);
  if (!id.success) return { status: "error", message: GENERIC_LISTING_ERROR };

  const fields = formFields(formData, ["operation", "reason"]);
  const parsed = accountStatusSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: { reason: fields.reason } };
  }

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: GENERIC_LISTING_ERROR };

  const { error } =
    parsed.data.operation === "suspend"
      ? await supabase.rpc("suspend_account", { p_profile_id: id.data, p_reason: parsed.data.reason })
      : await supabase.rpc("restore_account", { p_profile_id: id.data, p_reason: parsed.data.reason });
  if (error) {
    logAdminError(parsed.data.operation, error);
    return { status: "error", message: describeListingError(error).message, values: { reason: fields.reason } };
  }

  // Back to the same list (search re-parsed, never trusted) with a fixed notice.
  const params = new URLSearchParams({ notice: parsed.data.operation === "suspend" ? "suspended" : "restored" });
  const search = parseSearch(formFields(formData, ["q"]).q);
  if (search) params.set("q", search);
  redirect(`/admin/users?${params.toString()}`);
}
