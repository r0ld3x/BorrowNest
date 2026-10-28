import { ArrowLeftIcon, InfoIcon, LockIcon, MapPinIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { FormMessage } from "@/components/auth/form-parts";
import { BookingDecisionControls } from "@/components/bookings/booking-decision-controls";
import {
  BookingQuote,
  BookingStatusBadge,
} from "@/components/bookings/booking-parts";
import { HandoverPanel } from "@/components/bookings/handover-panel";
import { ReturnPanel } from "@/components/bookings/return-panel";
import { DisputeSection } from "@/components/disputes/dispute-section";
import { getBookingDisputes } from "@/lib/bookings/disputes";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageLoading } from "@/components/layout/page-loading";
import { CatalogueImage } from "@/components/listings/catalogue-image";
import { requireRole } from "@/lib/auth/session";
import { getHandover, getReturnSchedule } from "@/lib/bookings/handover";
import { getRenterBooking } from "@/lib/bookings/queries";
import { uuidSchema } from "@/lib/validation/listing";

export const metadata: Metadata = { title: "Booking request" };

const eventTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const EVENT_LABELS: Record<string, string> = {
  request_created: "Request sent",
  request_confirmed: "Confirmed by the provider",
  request_rejected: "Declined by the provider",
  request_cancelled: "Cancelled by you",
  admin_cancelled: "Cancelled by BorrowNest support",
  handover_prepared: "Handover summary shared by the provider",
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
  cancelled: "Request cancelled.",
  handover_revised: "Correction sent. You both confirm the new version.",
  handover_confirmed: "Handover confirmed. Waiting for the provider.",
  rental_active: "You both confirmed. The rental is now active.",
  evidence_added: "Photo added to the handover.",
  issue_reported:
    "Issue reported. The handover is on hold until BorrowNest support resolves it.",
  return_proposed:
    "Return time proposed. The other participant accepts it or suggests another.",
  return_accepted: "Return time agreed.",
  return_prepared:
    "Return summary shared. The renter can now review and confirm it.",
  return_revised: "Correction sent. You both confirm the new version.",
  return_confirmed: "Return confirmed. Waiting for the other participant.",
  rental_completed: "You both confirmed the return. The rental is complete.",
  dispute_opened: "Dispute opened. BorrowNest support will review it; confirmations are on hold until it’s resolved.",
  dispute_message: "Statement added to the dispute.",
  dispute_evidence: "Photo added to the dispute.",
} as const;

const NEXT_STEP: Record<string, string> = {
  pending:
    "This is a request, not a reservation. The provider confirms or declines it, and the item can still be booked by someone else until then.",
  confirmed:
    "Your dates are reserved. Meet the provider at the pickup address below at the agreed time, then confirm the handover summary together in the app.",
  rejected:
    "The provider declined this request. You can request other dates or another item.",
  cancelled: "This request is cancelled. Nothing is reserved.",
  completed: "This rental is complete: both of you confirmed the return.",
  closed: "BorrowNest support closed this booking after a dispute. See the decision and any amounts still owed below.",
};

async function RenterBookingPage({
  params,
  searchParams,
}: PageProps<"/renter/bookings/[id]">) {
  const profile = await requireRole(["renter"]);
  const [{ id }, { created, notice }] = await Promise.all([
    params,
    searchParams,
  ]);
  const bookingId = uuidSchema.safeParse(id);
  if (!bookingId.success) notFound();

  // Scoped to the signed-in renter in the database; anyone else gets nothing.
  const result = await getRenterBooking(bookingId.data);
  if (!result) notFound();
  const { booking, events, pickup } = result;
  const handover =
    booking.status === "confirmed" || booking.status === "completed" || booking.status === "closed"
      ? await getHandover(booking, profile.id)
      : null;
  // Return records exist only once the rental has been handed over.
  const [returnView, schedule] =
    handover && booking.phase !== "awaiting_handover"
      ? await Promise.all([
          getHandover(booking, profile.id, "return"),
          getReturnSchedule(booking),
        ])
      : [null, null];
  const disputes =
    booking.status === "confirmed" || booking.status === "completed" || booking.status === "closed"
      ? await getBookingDisputes(booking.id, profile.id)
      : null;
  const noticeText =
    typeof notice === "string" && notice in NOTICES
      ? NOTICES[notice as keyof typeof NOTICES]
      : null;

  return (
    <DashboardShell
      profile={profile}
      title={booking.status === "pending" ? "Booking request" : "Booking"}
    >
      <Link
        href="/renter/bookings"
        className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        All bookings
      </Link>

      {created === "1" ? (
        <div className="mb-6">
          <FormMessage
            status="success"
            message="Request sent. The provider will confirm or decline it. Nothing is reserved until then."
          />
        </div>
      ) : noticeText ? (
        <div className="mb-6">
          <FormMessage status="success" message={noticeText} />
        </div>
      ) : null}
      {booking.no_longer_available ? (
        <p
          role="status"
          className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
        >
          No longer available: another booking for these dates was confirmed.
          You can cancel this request and choose other dates.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="grid min-w-0 gap-6">
          <section
            aria-labelledby="booking-heading"
            className="grid gap-5 rounded-xl border border-border bg-card p-6"
          >
            <div className="flex gap-4">
              <div className="relative size-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                <CatalogueImage src={booking.coverUrl} alt="" sizes="96px" />
              </div>
              <div className="grid min-w-0 content-start gap-1">
                <h2
                  id="booking-heading"
                  className="text-lg font-semibold wrap-break-word"
                >
                  <Link
                    href={`/listings/${booking.product_id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {booking.product_title}
                  </Link>
                </h2>
                <p className="text-sm text-muted-foreground">
                  {booking.product_area}, Gwalior
                  {booking.product_landmark
                    ? ` · ${booking.product_landmark}`
                    : ""}
                </p>
                {booking.listed_by ? (
                  <p className="text-sm text-muted-foreground">
                    Provider: {booking.listed_by}
                  </p>
                ) : null}
                <div className="mt-1">
                  <BookingStatusBadge status={booking.status} />
                </div>
              </div>
            </div>

            <BookingQuote booking={booking} />

            {booking.note ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium">Your note</p>
                <p className="mt-1 whitespace-pre-line text-muted-foreground wrap-break-word">
                  {booking.note}
                </p>
              </div>
            ) : null}

            {booking.decision_reason &&
            booking.status !== "pending" &&
            booking.status !== "confirmed" ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium">Reason given</p>
                <p className="mt-1 whitespace-pre-line text-muted-foreground wrap-break-word">
                  {booking.decision_reason}
                </p>
              </div>
            ) : null}

            {pickup ? (
              <section
                aria-labelledby="pickup-heading"
                className="rounded-lg border border-primary/40 bg-accent p-4 text-sm"
              >
                <h3
                  id="pickup-heading"
                  className="flex items-center gap-2 font-semibold text-accent-foreground"
                >
                  <MapPinIcon aria-hidden="true" className="size-4" />
                  Pickup address
                </h3>
                <p className="mt-2 whitespace-pre-line wrap-break-word">
                  {pickup.exact_address}
                </p>
                {pickup.pickup_instructions ? (
                  <p className="mt-2 whitespace-pre-line text-muted-foreground wrap-break-word">
                    {pickup.pickup_instructions}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  Shared because this booking is confirmed. Keep it private.
                </p>
              </section>
            ) : null}

            {booking.status === "pending" ? (
              <BookingDecisionControls
                key={booking.status}
                bookingId={booking.id}
                actions={["cancel"]}
              />
            ) : null}
          </section>

          {handover ? (
            <HandoverPanel
              booking={booking}
              handover={handover}
              viewerRole="renter"
            />
          ) : null}
          {handover && returnView && schedule ? (
            <ReturnPanel
              booking={booking}
              schedule={schedule}
              returnView={returnView}
              viewerRole="renter"
              viewerId={profile.id}
              openIssues={handover.holds.length}
            />
          ) : handover && booking.phase !== "awaiting_handover" ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              The return could not be loaded. Please reload.
            </p>
          ) : null}
          {disputes ? (
            <DisputeSection
              bookingId={booking.id}
              bookingStatus={booking.status}
              viewerRole="renter"
              disputes={disputes.disputes}
              closure={disputes.closure}
              completionWindowEnds={disputes.completionWindowEnds}
              now={disputes.now}
            />
          ) : null}
          {!handover && booking.status === "confirmed" ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              The handover could not be loaded. Please reload.
            </p>
          ) : null}
        </div>

        <div className="grid gap-6">
          <section
            aria-labelledby="next-heading"
            className="grid gap-3 rounded-xl border border-border bg-card p-6 text-sm"
          >
            <h2
              id="next-heading"
              className="flex items-center gap-2 font-semibold"
            >
              <InfoIcon aria-hidden="true" className="size-4" />
              What happens next
            </h2>
            <p className="text-muted-foreground">{NEXT_STEP[booking.status]}</p>
            {booking.status === "pending" ? (
              <p className="flex items-start gap-2 text-muted-foreground">
                <LockIcon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />
                The exact pickup address is shared only after the provider
                confirms.
              </p>
            ) : null}
            <p className="text-muted-foreground">
              The price and deposit above are fixed for this request, even if
              the listing changes. Payment is made offline at pickup.
            </p>
          </section>

          <section
            aria-labelledby="timeline-heading"
            className="rounded-xl border border-border bg-card p-6"
          >
            <h2 id="timeline-heading" className="font-semibold">
              Timeline
            </h2>
            <ol className="mt-3 grid gap-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex justify-between gap-3">
                  <span>{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
                  <time
                    dateTime={e.created_at}
                    className="text-muted-foreground"
                  >
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
export default function Page(props: PageProps<"/renter/bookings/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <RenterBookingPage {...props} />
    </Suspense>
  );
}
