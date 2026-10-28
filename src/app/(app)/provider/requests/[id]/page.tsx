import { ArrowLeftIcon, MapPinIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { FormMessage } from "@/components/auth/form-parts";
import { BookingDecisionControls } from "@/components/bookings/booking-decision-controls";
import { BookingQuote, BookingStatusBadge } from "@/components/bookings/booking-parts";
import { HandoverPanel } from "@/components/bookings/handover-panel";
import { ReturnPanel } from "@/components/bookings/return-panel";
import { DisputeSection } from "@/components/disputes/dispute-section";
import { getBookingDisputes } from "@/lib/bookings/disputes";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageLoading } from "@/components/layout/page-loading";
import { CatalogueImage } from "@/components/listings/catalogue-image";
import { requireRole } from "@/lib/auth/session";
import { getHandover, getProviderBooking, getReturnSchedule } from "@/lib/bookings/handover";
import { uuidSchema } from "@/lib/validation/listing";

export const metadata: Metadata = { title: "Booking" };

const eventTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

const EVENT_LABELS: Record<string, string> = {
  request_created: "Request received",
  request_confirmed: "Confirmed by you",
  request_rejected: "Declined by you",
  request_cancelled: "Cancelled by the renter",
  admin_cancelled: "Cancelled by BorrowNest support",
  handover_prepared: "Handover summary shared",
  handover_revised: "Handover summary corrected",
  handover_confirmed: "Handover confirmed by a participant",
  rental_activated: "Rental started",
  issue_reported: "Issue reported (on hold)",
  issue_resolved: "Issue resolved by BorrowNest support",
  return_proposed: "Return time proposed",
  return_accepted: "Return time agreed",
  return_prepared: "Return summary shared by the provider",
  return_revised: "Return summary corrected",
  return_confirmed: "Return confirmed by a participant",
  rental_completed: "Rental completed",
  dispute_opened: "Dispute opened (on hold)",
  dispute_status_changed: "Dispute status updated by BorrowNest support",
  dispute_resolved: "Dispute resolved by BorrowNest support",
  admin_closed: "Closed by BorrowNest support",
};

// Fixed confirmation texts keyed by allowlisted codes; the query value is never echoed.
const NOTICES = {
  handover_prepared: "Summary shared. The renter can now review and confirm it.",
  handover_revised: "Correction sent. You both confirm the new version.",
  handover_confirmed: "Handover confirmed. Waiting for the renter.",
  rental_active: "You both confirmed. The rental is now active.",
  evidence_added: "Photo added to the handover.",
  issue_reported: "Issue reported. The handover is on hold until BorrowNest support resolves it.",
  return_proposed: "Return time proposed. The other participant accepts it or suggests another.",
  return_accepted: "Return time agreed.",
  return_prepared: "Return summary shared. The renter can now review and confirm it.",
  return_revised: "Correction sent. You both confirm the new version.",
  return_confirmed: "Return confirmed. Waiting for the other participant.",
  rental_completed: "You both confirmed the return. The rental is complete.",
  dispute_opened: "Dispute opened. BorrowNest support will review it; confirmations are on hold until it’s resolved.",
  dispute_message: "Statement added to the dispute.",
  dispute_evidence: "Photo added to the dispute.",
} as const;

async function ProviderBookingPage({ params, searchParams }: PageProps<"/provider/requests/[id]">) {
  const profile = await requireRole(["provider"]);
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const bookingId = uuidSchema.safeParse(id);
  if (!bookingId.success) notFound();

  // Scoped to this provider's listings in the database; anyone else gets nothing.
  const result = await getProviderBooking(bookingId.data);
  if (!result) notFound();
  const { booking, events, pickup } = result;
  const handover = booking.status === "confirmed" || booking.status === "completed" || booking.status === "closed" ? await getHandover(booking, profile.id) : null;
  // Return records exist only once the rental has been handed over.
  const [returnView, schedule] =
    handover && booking.phase !== "awaiting_handover"
      ? await Promise.all([getHandover(booking, profile.id, "return"), getReturnSchedule(booking)])
      : [null, null];
  const disputes =
    booking.status === "confirmed" || booking.status === "completed" || booking.status === "closed"
      ? await getBookingDisputes(booking.id, profile.id)
      : null;
  const noticeText = typeof notice === "string" && notice in NOTICES ? NOTICES[notice as keyof typeof NOTICES] : null;

  return (
    <DashboardShell profile={profile} title="Booking">
      <Link href="/provider/requests?status=confirmed" className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        All requests
      </Link>
      {noticeText ? (
        <div className="mb-6">
          <FormMessage status="success" message={noticeText} />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="grid min-w-0 gap-6">
          <section aria-labelledby="booking-heading" className="grid gap-5 rounded-xl border border-border bg-card p-6">
            <div className="flex gap-4">
              <div className="relative size-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                <CatalogueImage src={booking.coverUrl} alt="" sizes="96px" />
              </div>
              <div className="grid min-w-0 content-start gap-1">
                <h2 id="booking-heading" className="text-lg font-semibold wrap-break-word">
                  <Link href={`/provider/listings/${booking.product_id}`} className="underline-offset-4 hover:underline">
                    {booking.product_title}
                  </Link>
                </h2>
                <p className="text-sm text-muted-foreground">Renter: {booking.renter_name ?? "a renter"}</p>
                <div className="mt-1">
                  <BookingStatusBadge status={booking.status} />
                </div>
              </div>
            </div>
            <BookingQuote booking={booking} />
            {booking.note ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium">Renter’s note</p>
                <p className="mt-1 whitespace-pre-line text-muted-foreground wrap-break-word">{booking.note}</p>
              </div>
            ) : null}
            {booking.status === "pending" ? (
              <BookingDecisionControls
                key={booking.status}
                bookingId={booking.id}
                actions={["confirm", "reject"]}
                confirmBlockedReason={
                  booking.no_longer_available
                    ? "These dates are already reserved, so this request can only be declined."
                    : booking.pickup_expired
                      ? "The requested pickup time has passed, so this request can only be declined."
                      : null
                }
              />
            ) : null}
          </section>

          {handover ? (
            <HandoverPanel booking={booking} handover={handover} viewerRole="provider" />
          ) : null}
          {handover && returnView && schedule ? (
            <ReturnPanel
              booking={booking}
              schedule={schedule}
              returnView={returnView}
              viewerRole="provider"
              viewerId={profile.id}
              openIssues={handover.holds.length}
            />
          ) : handover && booking.phase !== "awaiting_handover" ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              The return could not be loaded. Please reload.
            </p>
          ) : null}
          {disputes ? (
            <DisputeSection
              bookingId={booking.id}
              bookingStatus={booking.status}
              viewerRole="provider"
              disputes={disputes.disputes}
              closure={disputes.closure}
              completionWindowEnds={disputes.completionWindowEnds}
              now={disputes.now}
            />
          ) : null}
          {!handover && booking.status === "confirmed" ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              The handover could not be loaded. Please reload.
            </p>
          ) : null}
        </div>

        <div className="grid gap-6">
          {pickup ? (
            <section aria-labelledby="pickup-heading" className="rounded-xl border border-border bg-card p-6 text-sm">
              <h2 id="pickup-heading" className="flex items-center gap-2 font-semibold">
                <MapPinIcon aria-hidden="true" className="size-4" />
                Pickup address shared
              </h2>
              <p className="mt-2 whitespace-pre-line wrap-break-word">{pickup.exact_address}</p>
              {pickup.pickup_instructions ? (
                <p className="mt-2 whitespace-pre-line text-muted-foreground wrap-break-word">{pickup.pickup_instructions}</p>
              ) : null}
            </section>
          ) : null}
          <section aria-labelledby="timeline-heading" className="rounded-xl border border-border bg-card p-6">
            <h2 id="timeline-heading" className="font-semibold">
              Timeline
            </h2>
            <ol className="mt-3 grid gap-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex justify-between gap-3">
                  <span>{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
                  <time dateTime={e.created_at} className="shrink-0 text-muted-foreground">
                    {eventTime.format(new Date(e.created_at))}
                  </time>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}

// Its own Suspense boundary, below every shared layout, so client navigations
// into this page show the loading state instead of blocking on server data.
export default function Page(props: PageProps<"/provider/requests/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ProviderBookingPage {...props} />
    </Suspense>
  );
}
