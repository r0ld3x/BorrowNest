import "server-only";

import { DISPUTE_EVIDENCE_BUCKET, EVIDENCE_BUCKET, EVIDENCE_URL_TTL } from "@/lib/bookings/handover";
import { createClient } from "@/lib/supabase/server";
import type { Database, DisputeStatus } from "@/types/database";

type Tables = Database["public"]["Tables"];
type Dispute = Tables["booking_disputes"]["Row"];
type Message = Tables["dispute_messages"]["Row"];
type Resolution = Tables["dispute_resolutions"]["Row"];
type Closure = Tables["admin_closures"]["Row"];
type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/** A post-completion case may be opened for this many days after completion. */
export const DISPUTE_WINDOW_DAYS = 14;
export const DISPUTES_PAGE_SIZE = 20;

export interface DisputeView extends Dispute {
  messages: Message[];
  evidence: { id: string; caption: string | null; url: string | null; uploaderRole: string; uploadedByYou: boolean; created_at: string }[];
  resolution: Resolution | null;
}

async function signUrls(supabase: Supabase, bucket: string, paths: string[]) {
  if (paths.length === 0) return new Map<string, string | null>();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, EVIDENCE_URL_TTL);
  if (error) console.error("Evidence signing failed", { name: error.name });
  return new Map((data ?? []).map((s) => [s.path ?? "", s.error ? null : s.signedUrl]));
}

/** Messages, evidence (signed links) and resolutions for the given disputes; all RLS-scoped. */
async function withDetails(supabase: Supabase, disputes: Dispute[], viewerId: string): Promise<DisputeView[] | null> {
  if (disputes.length === 0) return [];
  const ids = disputes.map((d) => d.id);
  const [messages, evidence, resolutions] = await Promise.all([
    supabase.from("dispute_messages").select("*").in("dispute_id", ids).order("created_at"),
    supabase.from("dispute_evidence").select("*").in("dispute_id", ids).order("created_at"),
    supabase.from("dispute_resolutions").select("*").in("dispute_id", ids),
  ]);
  const failed = messages.error ?? evidence.error ?? resolutions.error;
  if (failed) {
    console.error("Dispute detail query failed", { code: failed.code });
    return null;
  }
  const allMessages = messages.data ?? [];
  const allEvidence = evidence.data ?? [];
  const allResolutions = resolutions.data ?? [];
  const urls = await signUrls(supabase, DISPUTE_EVIDENCE_BUCKET, allEvidence.map((e) => e.storage_path));
  return disputes.map((d) => ({
    ...d,
    messages: allMessages.filter((m) => m.dispute_id === d.id),
    evidence: allEvidence
      .filter((e) => e.dispute_id === d.id)
      .map((e) => ({
        id: e.id,
        caption: e.caption,
        url: urls.get(e.storage_path) ?? null,
        uploaderRole: e.uploader_role,
        uploadedByYou: e.uploaded_by === viewerId,
        created_at: e.created_at,
      })),
    resolution: allResolutions.find((r) => r.dispute_id === d.id) ?? null,
  }));
}

/** Disputes on one booking for its participant, newest first, plus any administrative closure. */
export async function getBookingDisputes(bookingId: string, viewerId: string) {
  const supabase = await createClient();
  if (!supabase) return null;
  const [disputes, closure, completed] = await Promise.all([
    supabase.from("booking_disputes").select("*").eq("booking_id", bookingId).order("created_at", { ascending: false }),
    supabase.from("admin_closures").select("*").eq("booking_id", bookingId).maybeSingle(),
    supabase
      .from("booking_events")
      .select("created_at")
      .eq("booking_id", bookingId)
      .eq("event_type", "rental_completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const failed = disputes.error ?? closure.error ?? completed.error;
  if (failed) {
    console.error("Booking disputes query failed", { code: failed.code });
    return null;
  }
  const views = await withDetails(supabase, disputes.data ?? [], viewerId);
  if (!views) return null;
  const windowEnds = completed.data
    ? new Date(new Date(completed.data.created_at).getTime() + DISPUTE_WINDOW_DAYS * 86_400_000).toISOString()
    : null;
  return { disputes: views, closure: closure.data as Closure | null, completionWindowEnds: windowEnds, now: Date.now() };
}

export async function listDisputes(status: DisputeStatus | "all" | null, page: number) {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_list_disputes", {
    p_status: status,
    p_limit: DISPUTES_PAGE_SIZE,
    p_offset: (page - 1) * DISPUTES_PAGE_SIZE,
  });
  if (error) {
    console.error("Dispute queue query failed", { code: error.code });
    return null;
  }
  const total = data[0]?.total_count ?? 0;
  return { rows: data, total, page, pageCount: Math.max(1, Math.ceil(total / DISPUTES_PAGE_SIZE)) };
}

/**
 * Everything an admin needs to decide one dispute: the booking, both
 * participants' names (no contact details), every handover/return revision
 * with its confirmations and photos, the return schedule, all disputes on the
 * booking and the timeline. Admin RLS grants read access; nothing is public.
 */
export async function getAdminDispute(disputeId: string, adminId: string) {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: dispute, error } = await supabase.from("booking_disputes").select("*").eq("id", disputeId).maybeSingle();
  if (error) {
    console.error("Admin dispute query failed", { code: error.code });
    return null;
  }
  if (!dispute) return { notFound: true as const };

  const bookingId = dispute.booking_id;
  const [booking, disputes, exchanges, proposals, events, closure] = await Promise.all([
    supabase.from("bookings").select("*").eq("id", bookingId).single(),
    supabase.from("booking_disputes").select("*").eq("booking_id", bookingId).order("created_at"),
    supabase.from("booking_exchanges").select("*").eq("booking_id", bookingId).order("kind").order("revision"),
    supabase.from("return_proposals").select("*").eq("booking_id", bookingId).order("version"),
    supabase.from("booking_events").select("id, event_type, reason, created_at").eq("booking_id", bookingId).order("created_at"),
    supabase.from("admin_closures").select("*").eq("booking_id", bookingId).maybeSingle(),
  ]);
  const failed = booking.error ?? disputes.error ?? exchanges.error ?? proposals.error ?? events.error ?? closure.error;
  if (failed) {
    console.error("Admin dispute context query failed", { code: failed.code });
    return null;
  }
  if (!booking.data) return null;
  const b = booking.data;
  const allExchanges = exchanges.data ?? [];
  const exchangeIds = allExchanges.map((x) => x.id);
  const [product, people, confirmations, exEvidence] = await Promise.all([
    supabase.from("products").select("id, title, listing_status, inventory_hold").eq("id", b.product_id).single(),
    supabase.from("profiles").select("id, full_name, account_status").in("id", [b.renter_id, b.provider_id]),
    exchangeIds.length
      ? supabase.from("exchange_confirmations").select("exchange_id, participant_role, confirmed_at").in("exchange_id", exchangeIds)
      : Promise.resolve({ data: [], error: null }),
    exchangeIds.length
      ? supabase.from("exchange_evidence").select("id, exchange_id, storage_path, caption, created_at").in("exchange_id", exchangeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const failed2 = product.error ?? people.error ?? confirmations.error ?? exEvidence.error;
  if (failed2) {
    console.error("Admin dispute people query failed", { code: failed2.code });
    return null;
  }
  if (!product.data) return null;
  const [views, exUrls] = await Promise.all([
    withDetails(supabase, disputes.data ?? [], adminId),
    signUrls(supabase, EVIDENCE_BUCKET, (exEvidence.data ?? []).map((e) => e.storage_path)),
  ]);
  if (!views) return null;
  const person = (id: string) => (people.data ?? []).find((p) => p.id === id) ?? null;

  return {
    notFound: false as const,
    dispute: views.find((d) => d.id === disputeId)!,
    otherDisputes: views.filter((d) => d.id !== disputeId),
    booking: b,
    product: product.data,
    renter: person(b.renter_id),
    provider: person(b.provider_id),
    exchanges: allExchanges.map((x) => ({
      ...x,
      confirmations: (confirmations.data ?? []).filter((c) => c.exchange_id === x.id),
      evidence: (exEvidence.data ?? [])
        .filter((e) => e.exchange_id === x.id)
        .map((e) => ({ id: e.id, caption: e.caption, url: exUrls.get(e.storage_path) ?? null })),
    })),
    proposals: proposals.data ?? [],
    events: events.data ?? [],
    closure: closure.data,
  };
}
