"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/lib/auth/actions";
import { requireRole } from "@/lib/auth/session";
import { describeListingError, GENERIC_LISTING_ERROR } from "@/lib/listings/errors";
import { PHOTO_REJECTION_MESSAGES, processProductPhoto, signPhotoAttachment } from "@/lib/listings/images";
import { PRODUCT_PHOTOS_BUCKET } from "@/lib/listings/queries";
import { createClient } from "@/lib/supabase/server";
import { formFields, toFieldErrors } from "@/lib/validation/auth";
import {
  captionSchema,
  LISTING_FIELDS,
  listingSchema,
  statusOperationSchema,
  uuidSchema,
  type ListingInput,
} from "@/lib/validation/listing";

const NOT_CONFIGURED: FormState = { status: "error", message: "Listings are not available yet." };

export interface ActionResult {
  ok: boolean;
  message?: string;
}

function toRpcContent(input: ListingInput) {
  // Only whitelisted content fields. Owner, city, status, and moderation
  // fields are set inside the database functions.
  return {
    p_title: input.title,
    p_description: input.description,
    p_category: input.category,
    p_condition: input.condition,
    p_price_per_day: input.pricePerDay,
    p_deposit: input.deposit,
    p_area: input.area,
    p_landmark: input.landmark,
    p_exact_address: input.exactAddress,
    p_pickup_instructions: input.pickupInstructions,
  };
}

function logRpcError(operation: string, error: { code?: string; message?: string }) {
  // Error codes only; never field values, addresses, or tokens.
  const bnCode = error.message?.match(/BN:([a-z_]+)/)?.[1];
  console.error(`Listing operation failed: ${operation}`, { code: error.code, bnCode });
}

export async function createListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["provider"]);
  const fields = formFields(formData, LISTING_FIELDS);

  const parsed = listingSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", message: "Check the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values: fields };
  }

  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;

  const { data: productId, error } = await supabase.rpc("create_listing_draft", toRpcContent(parsed.data));
  if (error || !productId) {
    if (error) logRpcError("create", error);
    const described = describeListingError(error);
    return {
      status: "error",
      message: described.message,
      fieldErrors: described.field ? { [described.field.name]: described.field.message } : undefined,
      values: fields,
    };
  }

  redirect(`/provider/listings/${productId}?created=1`);
}

export async function updateListingAction(
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireRole(["provider"]);
  const fields = formFields(formData, LISTING_FIELDS);

  const id = uuidSchema.safeParse(productId);
  if (!id.success) return { status: "error", message: describeListingError(null).message, values: fields };

  const parsed = listingSchema.safeParse(fields);
  if (!parsed.success) {
    return { status: "error", message: "Check the highlighted fields.", fieldErrors: toFieldErrors(parsed.error), values: fields };
  }

  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;

  const { data: status, error } = await supabase.rpc("update_listing", {
    p_product_id: id.data,
    ...toRpcContent(parsed.data),
  });
  if (error) {
    logRpcError("update", error);
    const described = describeListingError(error);
    return {
      status: "error",
      message: described.message,
      fieldErrors: described.field ? { [described.field.name]: described.field.message } : undefined,
      values: fields,
    };
  }

  refresh();
  return {
    status: "success",
    message:
      status === "pending_review"
        ? "Changes saved. The listing will be reviewed again before it is public."
        : "Changes saved.",
    values: fields,
  };
}

const STATUS_RPC = {
  submit: "submit_listing",
  pause: "pause_listing",
  resume: "resume_listing",
  archive: "archive_listing",
} as const;

const STATUS_SUCCESS = {
  submit: "Submitted for review. An admin will check it before it goes public.",
  pause: "Listing paused. It is hidden from renters.",
  resume: "Listing is visible again.",
  archive: "Listing archived.",
} as const;

export async function changeListingStatusAction(productId: string, operation: string): Promise<ActionResult> {
  await requireRole(["provider"]);

  const id = uuidSchema.safeParse(productId);
  const op = statusOperationSchema.safeParse(operation);
  if (!id.success || !op.success) return { ok: false, message: GENERIC_LISTING_ERROR };

  const supabase = await createClient();
  if (!supabase) return { ok: false, message: NOT_CONFIGURED.message };

  const { error } = await supabase.rpc(STATUS_RPC[op.data], { p_product_id: id.data });
  if (error) {
    logRpcError(op.data, error);
    return { ok: false, message: describeListingError(error).message };
  }

  refresh();
  return { ok: true, message: STATUS_SUCCESS[op.data] };
}

export async function uploadListingPhotoAction(formData: FormData): Promise<ActionResult> {
  const profile = await requireRole(["provider"]);

  const productId = uuidSchema.safeParse(formData.get("productId"));
  if (!productId.success) return { ok: false, message: GENERIC_LISTING_ERROR };

  const rawCaption = formData.get("caption");
  const caption = captionSchema.safeParse(typeof rawCaption === "string" ? rawCaption : "");
  if (!caption.success) return { ok: false, message: "Captions must be 200 characters or fewer." };

  const photo = await processProductPhoto(formData.get("photo"));
  if (!photo.ok) return { ok: false, message: PHOTO_REJECTION_MESSAGES[photo.reason] };

  const supabase = await createClient();
  if (!supabase) return { ok: false, message: NOT_CONFIGURED.message };

  // Random object id; the provider and product folders are checked by the
  // storage policy against the database, not trusted from this path.
  const storagePath = `${profile.id}/${productId.data}/${randomUUID()}.webp`;
  const signature = signPhotoAttachment(profile.id, productId.data, storagePath);
  if (!signature) return { ok: false, message: describeListingError({ message: "BN:attestation_not_configured" }).message };

  const storage = supabase.storage.from(PRODUCT_PHOTOS_BUCKET);
  const upload = await storage.upload(storagePath, photo.data, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (upload.error) {
    console.error("Photo upload failed", { status: "statusCode" in upload.error ? upload.error.statusCode : undefined });
    return { ok: false, message: "The photo could not be uploaded. Your listing is unchanged; please try again." };
  }

  const { error } = await supabase.rpc("attach_product_image", {
    p_product_id: productId.data,
    p_storage_path: storagePath,
    p_caption: caption.data,
    p_signature: signature,
  });
  if (error) {
    logRpcError("attach-photo", error);
    // Best-effort cleanup of the now-orphaned object (own, unattached only).
    await storage.remove([storagePath]);
    return { ok: false, message: describeListingError(error).message };
  }

  refresh();
  return { ok: true };
}

export async function removeListingPhotoAction(imageId: string): Promise<ActionResult> {
  await requireRole(["provider"]);
  const id = uuidSchema.safeParse(imageId);
  if (!id.success) return { ok: false, message: GENERIC_LISTING_ERROR };

  const supabase = await createClient();
  if (!supabase) return { ok: false, message: NOT_CONFIGURED.message };

  const { data: storagePath, error } = await supabase.rpc("remove_product_image", { p_image_id: id.data });
  if (error || !storagePath) {
    if (error) logRpcError("remove-photo", error);
    return { ok: false, message: describeListingError(error).message };
  }

  // The metadata is gone, so the delete policy now allows removing the file.
  const removal = await supabase.storage.from(PRODUCT_PHOTOS_BUCKET).remove([storagePath]);
  if (removal.error) console.error("Photo file cleanup failed");

  refresh();
  return { ok: true };
}

export async function reorderListingPhotosAction(productId: string, imageIds: string[]): Promise<ActionResult> {
  await requireRole(["provider"]);
  const id = uuidSchema.safeParse(productId);
  const ids = uuidSchema.array().max(5).safeParse(imageIds);
  if (!id.success || !ids.success) return { ok: false, message: GENERIC_LISTING_ERROR };

  const supabase = await createClient();
  if (!supabase) return { ok: false, message: NOT_CONFIGURED.message };

  const { error } = await supabase.rpc("reorder_product_images", {
    p_product_id: id.data,
    p_image_ids: ids.data,
  });
  if (error) {
    logRpcError("reorder-photos", error);
    return { ok: false, message: describeListingError(error).message };
  }

  refresh();
  return { ok: true };
}
