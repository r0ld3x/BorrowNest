import "server-only";

import { productPhotoUrl } from "@/lib/listings/queries";
import { createClient } from "@/lib/supabase/server";
import type { Database, ExchangeMethod, ParticipantRole } from "@/types/database";

export const EVIDENCE_BUCKET = "exchange-evidence";
export const DISPUTE_EVIDENCE_BUCKET = "dispute-evidence";
export const MAX_EVIDENCE = 6;
/** Signed evidence links expire after this many seconds; reload for fresh ones. */
export const EVIDENCE_URL_TTL = 600;

export const PAYMENT_METHOD_LABELS: Record<ExchangeMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  none: "No refund due",
};

/** Fixed checklist keys, matching confirm_handover in the database. */
export const ACKNOWLEDGEMENTS: Record<ParticipantRole, readonly string[]> = {
  renter: ["received_item", "condition_agreed", "paid_amounts"],
  provider: ["handed_over_item", "condition_matches", "received_amounts"],
};

/** Fixed return checklist keys, matching confirm_return in the database. */
export const RETURN_ACKNOWLEDGEMENTS: Record<ParticipantRole, readonly string[]> = {
  renter: ["returned_item", "settlement_agreed", "refund_received"],
  provider: ["received_item", "condition_matches", "refund_paid"],
};

type Exchange = Database["public"]["Tables"]["booking_exchanges"]["Row"];
type Confirmation = Database["public"]["Tables"]["exchange_confirmations"]["Row"];
type Dispute = Database["public"]["Tables"]["booking_disputes"]["Row"];
export type ReturnProposal = Database["public"]["Tables"]["return_proposals"]["Row"];

export interface HandoverView {
  current: Exchange | null;
  superseded: Exchange[];
  confirmations: Pick<Confirmation, "participant_role" | "confirmed_at">[];
  evidence: { id: string; caption: string | null; url: string | null; uploadedByYou: boolean; created_at: string }[];
  /** The scheduled return time passed before both confirmed (needs support). */
  expired: boolean;
  /** Disputes that hold this booking (unresolved, not post-completion). Details live in the disputes section. */
  holds: Pick<Dispute, "id" | "category" | "status" | "opened_by_role" | "created_at">[];
}

/**
 * Handover (or return) records for one booking. Every read is RLS-scoped to
 * the booking's participants (and admins), so other users get empty results.
 */
export async function getHandover(
  booking: { id: string; return_at: string; phase: string },
  viewerId: string,
  kind: "handover" | "return" = "handover",
): Promise<HandoverView | null> {
  const bookingId = booking.id;
  const supabase = await createClient();
  if (!supabase) return null;
  const [exchanges, holds] = await Promise.all([
    supabase
      .from("booking_exchanges")
      .select("*")
      .eq("booking_id", bookingId)
      .eq("kind", kind)
      .order("revision", { ascending: false }),
    supabase
      .from("booking_disputes")
      .select("id, category, status, opened_by_role, created_at")
      .eq("booking_id", bookingId)
      .neq("status", "resolved")
      .eq("post_completion", false)
      .order("created_at"),
  ]);
  if (exchanges.error || holds.error) {
    console.error("Handover query failed", { code: exchanges.error?.code ?? holds.error?.code });
    return null;
  }
  const current = exchanges.data.find((x) => x.status === "current") ?? null;
  const view: HandoverView = {
    current,
    superseded: exchanges.data.filter((x) => x.status === "superseded"),
    confirmations: [],
    evidence: [],
    expired: kind === "handover" && booking.phase === "awaiting_handover" && Date.now() >= new Date(booking.return_at).getTime(),
    holds: holds.data,
  };
  if (!current) return view;

  const [confirmations, evidence] = await Promise.all([
    supabase.from("exchange_confirmations").select("participant_role, confirmed_at").eq("exchange_id", current.id),
    supabase
      .from("exchange_evidence")
      .select("id, storage_path, caption, uploaded_by, created_at")
      .eq("exchange_id", current.id)
      .order("created_at"),
  ]);
  if (confirmations.error || evidence.error) {
    console.error("Handover detail query failed", { code: confirmations.error?.code ?? evidence.error?.code });
    return null;
  }
  view.confirmations = confirmations.data;

  if (evidence.data.length > 0) {
    // Private bucket: short-lived links, checked by the storage read policy.
    const { data: signed, error } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrls(evidence.data.map((e) => e.storage_path), EVIDENCE_URL_TTL);
    if (error) console.error("Evidence signing failed", { name: error.name });
    const urls = new Map((signed ?? []).map((s) => [s.path, s.error ? null : s.signedUrl]));
    view.evidence = evidence.data.map((e) => ({
      id: e.id,
      caption: e.caption,
      url: urls.get(e.storage_path) ?? null,
      uploadedByYou: e.uploaded_by === viewerId,
      created_at: e.created_at,
    }));
  }
  return view;
}

/** One booking for its provider, with the pickup snapshot and phase. */
export async function getProviderBooking(bookingId: string) {
  const supabase = await createClient();
  if (!supabase) return null;
  const [booking, phase, events, pickup] = await Promise.all([
    supabase.rpc("provider_booking_requests", { p_status: null, p_booking_id: bookingId, p_limit: 1, p_offset: 0 }).maybeSingle(),
    supabase.from("bookings").select("phase, product_id").eq("id", bookingId).maybeSingle(),
    supabase.from("booking_events").select("id, event_type, next_status, created_at").eq("booking_id", bookingId).order("created_at"),
    supabase.from("booking_pickup_snapshots").select("exact_address, pickup_instructions").eq("booking_id", bookingId).maybeSingle(),
  ]);
  const failed = booking.error ?? phase.error ?? events.error ?? pickup.error;
  if (failed) {
    console.error("Provider booking query failed", { code: failed.code });
    return null;
  }
  if (!booking.data || !phase.data) return null;
  const cover = await supabase
    .from("product_images")
    .select("storage_path")
    .eq("product_id", phase.data.product_id)
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  return {
    booking: {
      ...booking.data,
      phase: phase.data.phase,
      coverUrl: cover.data ? productPhotoUrl(cover.data.storage_path) : null,
    },
    events: events.data ?? [],
    pickup: pickup.data,
  };
}

/** Return scheduling for one booking, newest version first, plus whether it is overdue. */
export async function getReturnSchedule(booking: { id: string; return_at: string; status: string }) {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("return_proposals")
    .select("*")
    .eq("booking_id", booking.id)
    .order("version", { ascending: false });
  if (error) {
    console.error("Return proposals query failed", { code: error.code });
    return null;
  }
  return {
    proposals: data,
    current: data.find((p) => p.status === "pending" || p.status === "accepted") ?? null,
    latestVersion: data[0]?.version ?? 0,
    overdue: booking.status === "confirmed" && Date.now() >= new Date(booking.return_at).getTime(),
  };
}
