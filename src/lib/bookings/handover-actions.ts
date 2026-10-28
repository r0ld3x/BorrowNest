"use server";

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/lib/auth/actions";
import { requireRole } from "@/lib/auth/session";
import { isValidDate, isValidTime, gwaliorTimestamp } from "@/lib/bookings/dates";
import { ACKNOWLEDGEMENTS, DISPUTE_EVIDENCE_BUCKET, EVIDENCE_BUCKET, RETURN_ACKNOWLEDGEMENTS } from "@/lib/bookings/handover";
import { parseRupees } from "@/lib/bookings/settlement";
import { PHOTO_REJECTION_MESSAGES, processProductPhoto, signDisputeAttachment, signEvidenceAttachment } from "@/lib/listings/images";
import { createClient } from "@/lib/supabase/server";
import { formFields, toFieldErrors } from "@/lib/validation/auth";

// Shared messages for database refusals. Field-specific ones name the field.
const MESSAGES: Record<string, string | [field: string, message: string]> = {
  booking_not_found: "That booking could not be found.",
  account_not_active: "Your account is not active, so this can’t be done.",
  provider_prepares_handover: "Only the provider can prepare the handover summary.",
  handover_not_open: "The handover for this booking is already finished or no longer open. Reload to see its status.",
  handover_expired: "The scheduled return time has passed, so this handover can’t continue here. Report an issue for BorrowNest support.",
  handover_exists: "A handover summary already exists. Reload to see it.",
  stale_revision: "The summary was changed while you were looking at it. Review the new version and confirm again.",
  amount_mismatch: "The amounts don’t match this booking. Reload and try again.",
  issue_open: "A dispute is open on this booking. Confirmation is on hold until BorrowNest support resolves it.",
  acknowledgements_required: ["ack", "Tick every statement to confirm."],
  invalid_payment_method: ["paymentMethod", "Choose how the money is paid."],
  invalid_condition_notes: ["conditionNotes", "Describe the item’s condition in 3 to 1,000 characters."],
  no_change: ["conditionNotes", "Change the notes or the payment method to send a correction."],
  reason_required: ["reason", "Say briefly what needs correcting (at least 5 characters)."],
  reason_too_long: ["reason", "Keep the reason to 500 characters or fewer."],
  invalid_category: ["category", "Choose what the dispute is about."],
  invalid_description: ["description", "Explain what happened in 10 to 1,000 characters."],
  too_many_issues: "This booking already has 5 open disputes. Wait for BorrowNest support to respond.",
  evidence_limit: "A handover can have at most 6 photos.",
  invalid_image_signature: "The photo could not be verified. Please upload it again.",
  attestation_not_configured: "Photo uploads are not configured on this server yet.",
  image_already_used: "That photo was already added.",
  not_active_admin: "Only active admins can do this.",
  issue_not_found: "That issue could not be found.",
  // Stage 9 return and settlement.
  rental_not_active: "Returns can only be arranged for an active rental. Reload to see its status.",
  return_in_progress: "A return summary already exists, so the time can’t be changed. Correct the summary instead.",
  stale_proposal: "The return time was changed while you were looking. Review the latest proposal.",
  proposal_in_past: ["returnDate", "Choose a return time in the future."],
  after_scheduled_return: ["returnDate", "Choose a time at or before the original return time. Extensions aren’t supported."],
  late_return_too_far: ["returnDate", "This rental is overdue: choose a time within the next 7 days."],
  invalid_note: ["note", "Keep the note to 300 characters or fewer."],
  cannot_accept_own_proposal: "You can’t accept your own proposal. The other participant accepts or suggests another time.",
  provider_prepares_return: "Only the provider prepares the return summary.",
  return_not_open: "The return isn’t open: agree a return time first, or reload to see its status.",
  return_exists: "A return summary already exists. Reload to see it.",
  return_not_scheduled: "Agree a return time before preparing the return summary.",
  invalid_deduction: ["deduction", "Enter a deduction between ₹0 and the deposit, with at most two decimals."],
  deduction_reason_required: ["deductionReason", "Explain any deduction (at least 5 characters)."],
  settlement_mismatch: "The settlement changed while you were looking at it. Review it and confirm again.",
  handover_not_confirmed: "This booking has no confirmed handover, so it can’t be returned here.",
  // Stage 10 disputes.
  booking_not_disputable: "Disputes can be opened on confirmed bookings, or within 14 days after completion.",
  dispute_window_closed: "The 14-day window after completion has passed. Contact BorrowNest support another way.",
  dispute_resolved: "This dispute is already resolved. Open a new dispute if something else is wrong.",
  dispute_not_found: "That dispute could not be found.",
  invalid_message: ["body", "Write a statement of up to 2,000 characters."],
  too_many_messages: "This dispute has reached its 50-statement limit. BorrowNest support will review it.",
  invalid_status: "Choose a valid status.",
  note_required: ["note", "Say what information you need (at least 10 characters)."],
  invalid_decision: ["decision", "Choose a decision."],
  invalid_amount: ["providerOwesRenter", "Amounts must be between ₹0 and ₹10,00,000, with at most two decimals."],
  invalid_possession: ["possession", "Say where the item is."],
  possession_required: ["possession", "The item may still be with the renter: say where it is."],
  possession_unresolved: ["possession", "A booking can’t be closed while the item is still with the renter."],
  closure_not_applicable: ["decision", "Only a rental in progress can be closed by support."],
  other_disputes_open: ["decision", "Resolve the other open disputes on this booking before closing it."],
  invalid_participant: ["onBehalf", "Choose the renter or the provider."],
  product_not_found: "That listing could not be found.",
};

function fail(error: { code?: string; message?: string } | null, operation: string, values?: Record<string, string>): FormState {
  const code = error?.message?.match(/BN:([a-z_]+)/)?.[1];
  console.error(`Handover operation failed: ${operation}`, { code: error?.code, bnCode: code });
  const mapped = code ? MESSAGES[code] : undefined;
  if (Array.isArray(mapped)) {
    return { status: "error", message: "Check the highlighted fields.", fieldErrors: { [mapped[0]]: mapped[1] }, values };
  }
  return { status: "error", message: mapped ?? "That didn’t work. Please reload and try again.", values };
}

const block = () =>
  z
    .string()
    .transform((v) => v.replace(/\r\n?/g, "\n").replace(/[\u0001-\u0009\u000B-\u001F\u007F]/g, "").trim());

const uuid = z.uuid({ version: "v4" });
const paymentMethod = z.enum(["cash", "upi", "bank_transfer"], { error: "Choose how the money is paid." });
const conditionNotes = block().pipe(
  z.string().min(3, "Describe the item’s condition (at least 3 characters).").max(1000, "Keep the notes to 1,000 characters or fewer."),
);

function bookingPath(role: string, bookingId: string) {
  return role === "provider" ? `/provider/requests/${bookingId}` : `/renter/bookings/${bookingId}`;
}

const prepareSchema = z.object({ bookingId: uuid, conditionNotes, paymentMethod });

export async function prepareHandoverAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["provider"]);
  const fields = formFields(formData, ["bookingId", "conditionNotes", "paymentMethod"]);
  const parsed = prepareSchema.safeParse(fields);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: fields };

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now.", values: fields };
  const { error } = await supabase.rpc("prepare_handover", {
    p_booking_id: parsed.data.bookingId,
    p_condition_notes: parsed.data.conditionNotes,
    p_payment_method: parsed.data.paymentMethod,
  });
  if (error) return fail(error, "prepare", fields);
  redirect(`/provider/requests/${parsed.data.bookingId}?notice=handover_prepared`);
}

const reviseSchema = z.object({
  bookingId: uuid,
  exchangeId: uuid,
  revision: z.coerce.number().int().positive(),
  conditionNotes,
  paymentMethod,
  reason: block().pipe(
    z.string().min(5, "Say briefly what needs correcting (at least 5 characters).").max(500, "Keep the reason to 500 characters or fewer."),
  ),
});

/** Either participant: creates a new revision; earlier confirmations stop counting. */
export async function reviseHandoverAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole(["renter", "provider"]);
  const fields = formFields(formData, ["bookingId", "exchangeId", "revision", "conditionNotes", "paymentMethod", "reason"]);
  const parsed = reviseSchema.safeParse(fields);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: fields };

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now.", values: fields };
  const { error } = await supabase.rpc("revise_handover", {
    p_exchange_id: parsed.data.exchangeId,
    p_expected_revision: parsed.data.revision,
    p_condition_notes: parsed.data.conditionNotes,
    p_payment_method: parsed.data.paymentMethod,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, "revise", fields);
  redirect(`${bookingPath(profile.role, parsed.data.bookingId)}?notice=handover_revised`);
}

const confirmSchema = z.object({ bookingId: uuid, exchangeId: uuid, revision: z.coerce.number().int().positive() });

export async function confirmHandoverAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole(["renter", "provider"]);
  const parsed = confirmSchema.safeParse(formFields(formData, ["bookingId", "exchangeId", "revision"]));
  if (!parsed.success) return { status: "error", message: "Something went wrong. Reload the page and try again." };

  // Only the fixed keys for this role; anything else is dropped. The
  // database checks the set again and derives the role itself.
  const allowed = ACKNOWLEDGEMENTS[profile.role === "provider" ? "provider" : "renter"];
  const ticked = new Set(formData.getAll("ack").filter((v): v is string => typeof v === "string"));
  const acknowledgements = allowed.filter((key) => ticked.has(key));
  if (acknowledgements.length !== allowed.length) {
    return { status: "error", message: "Check the highlighted fields.", fieldErrors: { ack: "Tick every statement to confirm." } };
  }

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now." };
  const { data: phase, error } = await supabase.rpc("confirm_handover", {
    p_exchange_id: parsed.data.exchangeId,
    p_revision: parsed.data.revision,
    p_acknowledgements: acknowledgements,
  });
  if (error || !phase) return fail(error, "confirm");
  redirect(`${bookingPath(profile.role, parsed.data.bookingId)}?notice=${phase === "active" ? "rental_active" : "handover_confirmed"}`);
}

const evidenceSchema = z.object({
  bookingId: uuid,
  exchangeId: uuid,
  caption: block().pipe(z.string().max(200, "Captions must be 200 characters or fewer.")),
});

export async function uploadEvidenceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole(["renter", "provider"]);
  const fields = formFields(formData, ["bookingId", "exchangeId", "caption"]);
  const parsed = evidenceSchema.safeParse(fields);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: { caption: fields.caption } };

  // Real decode and re-encode: forged MIME types, oversized or animated
  // files are refused, and EXIF (including GPS) is stripped.
  const photo = await processProductPhoto(formData.get("photo"));
  if (!photo.ok) {
    return { status: "error", fieldErrors: { photo: PHOTO_REJECTION_MESSAGES[photo.reason] }, values: { caption: fields.caption } };
  }

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now." };
  const storagePath = `${parsed.data.bookingId}/${parsed.data.exchangeId}/${randomUUID()}.webp`;
  const signature = signEvidenceAttachment(profile.id, parsed.data.exchangeId, storagePath);
  if (!signature) return fail({ message: "BN:attestation_not_configured" }, "evidence-sign");

  // The storage policy checks the booking/exchange folders against the
  // database (participant, current revision, handover still open).
  const upload = await supabase.storage.from(EVIDENCE_BUCKET).upload(storagePath, photo.data, {
    contentType: "image/webp",
    upsert: false,
  });
  if (upload.error) {
    console.error("Evidence upload failed", { status: "statusCode" in upload.error ? upload.error.statusCode : undefined });
    return { status: "error", message: "The photo could not be uploaded. Reload the page; the handover may have changed.", values: { caption: fields.caption } };
  }

  const { error } = await supabase.rpc("attach_exchange_evidence", {
    p_exchange_id: parsed.data.exchangeId,
    p_storage_path: storagePath,
    p_caption: parsed.data.caption,
    p_signature: signature,
  });
  // An unattached upload stays private and unlisted; evidence is never deleted.
  if (error) return fail(error, "evidence-attach", { caption: fields.caption });
  redirect(`${bookingPath(profile.role, parsed.data.bookingId)}?notice=evidence_added`);
}

// ---------------------------------------------------------------------------
// Stage 10: disputes (participants) and administrative resolution (admins)
// ---------------------------------------------------------------------------
const DISPUTE_CATEGORIES = ["handover", "payment", "condition", "return", "refund", "other"] as const;

const disputeSchema = z.object({
  bookingId: uuid,
  category: z.enum(DISPUTE_CATEGORIES, { error: "Choose what the dispute is about." }),
  description: block().pipe(
    z.string().min(10, "Explain what happened (at least 10 characters).").max(1000, "Keep it to 1,000 characters or fewer."),
  ),
});

/** Opens a dispute. While it is unresolved it holds handover and return confirmation. */
export async function openDisputeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole(["renter", "provider"]);
  const fields = formFields(formData, ["bookingId", "category", "description"]);
  const parsed = disputeSchema.safeParse(fields);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: fields };

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now.", values: fields };
  const { error } = await supabase.rpc("open_dispute", {
    p_booking_id: parsed.data.bookingId,
    p_category: parsed.data.category,
    p_description: parsed.data.description,
  });
  if (error) return fail(error, "open-dispute", fields);
  redirect(`${bookingPath(profile.role, parsed.data.bookingId)}?notice=dispute_opened#disputes`);
}

const messageSchema = z.object({
  bookingId: uuid,
  disputeId: uuid,
  body: block().pipe(z.string().min(1, "Write your statement.").max(2000, "Keep it to 2,000 characters or fewer.")),
});

/** Appends the caller's own statement; nobody can edit another person's. */
export async function addDisputeMessageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole(["renter", "provider"]);
  const fields = formFields(formData, ["bookingId", "disputeId", "body"]);
  const parsed = messageSchema.safeParse(fields);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: { body: fields.body } };

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now.", values: { body: fields.body } };
  const { error } = await supabase.rpc("add_dispute_message", { p_dispute_id: parsed.data.disputeId, p_body: parsed.data.body });
  if (error) return fail(error, "dispute-message", { body: fields.body });
  redirect(`${bookingPath(profile.role, parsed.data.bookingId)}?notice=dispute_message#dispute-${parsed.data.disputeId}`);
}

const disputeEvidenceSchema = z.object({
  bookingId: uuid,
  disputeId: uuid,
  caption: block().pipe(z.string().max(200, "Captions must be 200 characters or fewer.")),
});

export async function uploadDisputeEvidenceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole(["renter", "provider"]);
  const fields = formFields(formData, ["bookingId", "disputeId", "caption"]);
  const parsed = disputeEvidenceSchema.safeParse(fields);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: { caption: fields.caption } };

  const photo = await processProductPhoto(formData.get("photo"));
  if (!photo.ok) {
    return { status: "error", fieldErrors: { photo: PHOTO_REJECTION_MESSAGES[photo.reason] }, values: { caption: fields.caption } };
  }

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now." };
  const storagePath = `${parsed.data.bookingId}/${parsed.data.disputeId}/${randomUUID()}.webp`;
  const signature = signDisputeAttachment(profile.id, parsed.data.disputeId, storagePath);
  if (!signature) return fail({ message: "BN:attestation_not_configured" }, "dispute-evidence-sign");

  const upload = await supabase.storage.from(DISPUTE_EVIDENCE_BUCKET).upload(storagePath, photo.data, {
    contentType: "image/webp",
    upsert: false,
  });
  if (upload.error) {
    console.error("Dispute evidence upload failed", { status: "statusCode" in upload.error ? upload.error.statusCode : undefined });
    return { status: "error", message: "The photo could not be uploaded. Reload the page; the dispute may have been resolved.", values: { caption: fields.caption } };
  }
  const { error } = await supabase.rpc("attach_dispute_evidence", {
    p_dispute_id: parsed.data.disputeId,
    p_storage_path: storagePath,
    p_caption: parsed.data.caption,
    p_signature: signature,
  });
  if (error) return fail(error, "dispute-evidence-attach", { caption: fields.caption });
  redirect(`${bookingPath(profile.role, parsed.data.bookingId)}?notice=dispute_evidence#dispute-${parsed.data.disputeId}`);
}

const statusSchema = z.object({
  disputeId: uuid,
  status: z.enum(["in_review", "needs_info"], { error: "Choose a status." }),
  note: block().pipe(z.string().max(2000, "Keep the note to 2,000 characters or fewer.")),
});

/** In-app only: participants see the status and note on their booking page. */
export async function adminSetDisputeStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const fields = formFields(formData, ["disputeId", "status", "note"]);
  const parsed = statusSchema.safeParse(fields);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: { note: fields.note } };

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Disputes are not available right now." };
  const { error } = await supabase.rpc("admin_set_dispute_status", {
    p_dispute_id: parsed.data.disputeId,
    p_status: parsed.data.status,
    p_note: parsed.data.note,
  });
  if (error) return fail(error, "dispute-status", { note: fields.note });
  redirect(`/admin/disputes/${parsed.data.disputeId}?notice=status`);
}

const amount = z.string().trim().refine((v) => parseRupees(v) !== null, "Enter an amount in rupees, like 0 or 250.50.");
const resolutionSchema = z.object({
  disputeId: uuid,
  decision: z.enum(["no_action", "renter_favoured", "provider_favoured", "shared", "admin_closure"], { error: "Choose a decision." }),
  reason: block().pipe(z.string().min(10, "Explain the decision (at least 10 characters).").max(1000, "Keep it to 1,000 characters or fewer.")),
  facts: block().pipe(z.string().max(2000, "Keep it to 2,000 characters or fewer.")),
  providerOwesRenter: amount,
  renterOwesProvider: amount,
  obligationNote: block().pipe(z.string().max(500, "Keep it to 500 characters or fewer.")),
  possession: z.enum(["not_applicable", "with_renter", "returned_to_provider", "lost", "damaged"], { error: "Say where the item is." }),
});

export async function adminResolveDisputeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const fields = formFields(formData, [
    "disputeId",
    "decision",
    "reason",
    "facts",
    "providerOwesRenter",
    "renterOwesProvider",
    "obligationNote",
    "possession",
  ]);
  const parsed = resolutionSchema.safeParse(fields);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: fields };

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Disputes are not available right now.", values: fields };
  const { data: outcome, error } = await supabase.rpc("admin_resolve_dispute", {
    p_dispute_id: parsed.data.disputeId,
    p_decision: parsed.data.decision,
    p_reason: parsed.data.reason,
    p_facts: parsed.data.facts,
    p_provider_owes_renter: parsed.data.providerOwesRenter,
    p_renter_owes_provider: parsed.data.renterOwesProvider,
    p_obligation_note: parsed.data.obligationNote,
    p_possession: parsed.data.possession,
  });
  if (error || !outcome) return fail(error, "dispute-resolve", fields);
  redirect(`/admin/disputes/${parsed.data.disputeId}?notice=${outcome}`);
}

const onBehalfSchema = disputeSchema.extend({ onBehalf: z.enum(["renter", "provider"], { error: "Choose who reported it." }) });

/** For a participant who can't act themselves (e.g. suspended). Recorded as support, never as them. */
export async function adminOpenDisputeForAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const fields = formFields(formData, ["bookingId", "onBehalf", "category", "description"]);
  const parsed = onBehalfSchema.safeParse(fields);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: fields };

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Disputes are not available right now.", values: fields };
  const { data: disputeId, error } = await supabase.rpc("admin_open_dispute_for", {
    p_booking_id: parsed.data.bookingId,
    p_on_behalf: parsed.data.onBehalf,
    p_category: parsed.data.category,
    p_description: parsed.data.description,
  });
  if (error || !disputeId) return fail(error, "dispute-open-on-behalf", fields);
  redirect(`/admin/disputes/${disputeId}?notice=opened`);
}

const releaseSchema = z.object({
  disputeId: uuid,
  productId: uuid,
  reason: block().pipe(z.string().min(10, "Explain why the item is available again (at least 10 characters).").max(500, "Keep it to 500 characters or fewer.")),
});

export async function adminReleaseInventoryHoldAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["admin"]);
  const fields = formFields(formData, ["disputeId", "productId", "reason"]);
  const parsed = releaseSchema.safeParse(fields);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: { reason: fields.reason } };

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Disputes are not available right now." };
  const { error } = await supabase.rpc("admin_release_inventory_hold", { p_product_id: parsed.data.productId, p_reason: parsed.data.reason });
  if (error) return fail(error, "inventory-release", { reason: fields.reason });
  redirect(`/admin/disputes/${parsed.data.disputeId}?notice=released`);
}

// ---------------------------------------------------------------------------
// Stage 9: return scheduling and settlement
// ---------------------------------------------------------------------------
const note = z
  .string()
  .transform((v) => v.replace(/[\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim())
  .pipe(z.string().max(300, "Keep the note to 300 characters or fewer."));

const proposeSchema = z.object({
  bookingId: uuid,
  returnDate: z.string().refine(isValidDate, "Choose a date."),
  returnTime: z.string().refine(isValidTime, "Choose a time."),
  note,
  expectedVersion: z.coerce.number().int().min(0),
});

/** Propose (or counter-propose) a return time, entered in Gwalior time. */
export async function proposeReturnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole(["renter", "provider"]);
  const fields = formFields(formData, ["bookingId", "returnDate", "returnTime", "note", "expectedVersion"]);
  const parsed = proposeSchema.safeParse(fields);
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: fields };

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now.", values: fields };
  const { error } = await supabase.rpc("propose_return", {
    p_booking_id: parsed.data.bookingId,
    p_proposed_at: gwaliorTimestamp(parsed.data.returnDate, parsed.data.returnTime),
    p_note: parsed.data.note,
    p_expected_version: parsed.data.expectedVersion,
  });
  if (error) return fail(error, "propose-return", fields);
  redirect(`${bookingPath(profile.role, parsed.data.bookingId)}?notice=return_proposed`);
}

const acceptSchema = z.object({ bookingId: uuid, proposalId: uuid });

export async function acceptReturnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole(["renter", "provider"]);
  const parsed = acceptSchema.safeParse(formFields(formData, ["bookingId", "proposalId"]));
  if (!parsed.success) return { status: "error", message: "Something went wrong. Reload the page and try again." };

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now." };
  const { error } = await supabase.rpc("accept_return", { p_proposal_id: parsed.data.proposalId });
  if (error) return fail(error, "accept-return");
  redirect(`${bookingPath(profile.role, parsed.data.bookingId)}?notice=return_accepted`);
}

const rupees = z.string().trim().refine((v) => parseRupees(v) !== null, "Enter an amount in rupees, like 0 or 250.50.");
const refundMethod = z.enum(["cash", "upi", "bank_transfer", "none"], { error: "Choose how the refund is paid." });
const deductionReason = z
  .string()
  .transform((v) => v.replace(/[\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim())
  .pipe(z.string().max(500, "Keep the reason to 500 characters or fewer."));

const prepareReturnSchema = z.object({ bookingId: uuid, conditionNotes, deduction: rupees, deductionReason, refundMethod });

export async function prepareReturnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["provider"]);
  const fields = formFields(formData, ["bookingId", "conditionNotes", "deduction", "deductionReason", "refundMethod"]);
  const parsed = prepareReturnSchema.safeParse({ ...fields, refundMethod: fields.refundMethod || "none" });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: fields };

  // Amounts go as exact decimal strings; the database checks the deposit
  // bounds and the refund method again.
  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now.", values: fields };
  const { error } = await supabase.rpc("prepare_return", {
    p_booking_id: parsed.data.bookingId,
    p_condition_notes: parsed.data.conditionNotes,
    p_deduction: parsed.data.deduction,
    p_deduction_reason: parsed.data.deductionReason,
    p_refund_method: parsed.data.refundMethod,
  });
  if (error) return fail(error, "prepare-return", fields);
  redirect(`/provider/requests/${parsed.data.bookingId}?notice=return_prepared`);
}

const reviseReturnSchema = prepareReturnSchema.extend({
  exchangeId: uuid,
  revision: z.coerce.number().int().positive(),
  reason: block().pipe(
    z.string().min(5, "Say briefly what needs correcting (at least 5 characters).").max(500, "Keep the reason to 500 characters or fewer."),
  ),
});

export async function reviseReturnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole(["renter", "provider"]);
  const fields = formFields(formData, [
    "bookingId",
    "exchangeId",
    "revision",
    "conditionNotes",
    "deduction",
    "deductionReason",
    "refundMethod",
    "reason",
  ]);
  const parsed = reviseReturnSchema.safeParse({ ...fields, refundMethod: fields.refundMethod || "none" });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: fields };

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now.", values: fields };
  const { error } = await supabase.rpc("revise_return", {
    p_exchange_id: parsed.data.exchangeId,
    p_expected_revision: parsed.data.revision,
    p_condition_notes: parsed.data.conditionNotes,
    p_deduction: parsed.data.deduction,
    p_deduction_reason: parsed.data.deductionReason,
    p_refund_method: parsed.data.refundMethod,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, "revise-return", fields);
  redirect(`${bookingPath(profile.role, parsed.data.bookingId)}?notice=return_revised`);
}

const confirmReturnSchema = z.object({
  bookingId: uuid,
  exchangeId: uuid,
  revision: z.coerce.number().int().positive(),
  deduction: rupees,
  refund: rupees,
});

/** The amounts the participant saw travel with the confirmation; a mismatch is refused. */
export async function confirmReturnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireRole(["renter", "provider"]);
  const parsed = confirmReturnSchema.safeParse(formFields(formData, ["bookingId", "exchangeId", "revision", "deduction", "refund"]));
  if (!parsed.success) return { status: "error", message: "Something went wrong. Reload the page and try again." };

  const allowed = RETURN_ACKNOWLEDGEMENTS[profile.role === "provider" ? "provider" : "renter"];
  const ticked = new Set(formData.getAll("ack").filter((v): v is string => typeof v === "string"));
  const acknowledgements = allowed.filter((key) => ticked.has(key));
  if (acknowledgements.length !== allowed.length) {
    return { status: "error", message: "Check the highlighted fields.", fieldErrors: { ack: "Tick every statement to confirm." } };
  }

  const supabase = await createClient();
  if (!supabase) return { status: "error", message: "Bookings are not available right now." };
  const { data: phase, error } = await supabase.rpc("confirm_return", {
    p_exchange_id: parsed.data.exchangeId,
    p_revision: parsed.data.revision,
    p_deduction: parsed.data.deduction,
    p_refund: parsed.data.refund,
    p_acknowledgements: acknowledgements,
  });
  if (error || !phase) return fail(error, "confirm-return");
  redirect(`${bookingPath(profile.role, parsed.data.bookingId)}?notice=${phase === "returned" ? "rental_completed" : "return_confirmed"}`);
}
