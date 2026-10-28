import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { FormMessage } from "@/components/auth/form-parts";
import { BookingQuote, BookingStatusBadge } from "@/components/bookings/booking-parts";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import {
  DisputeStatusForm,
  OpenDisputeForParticipantForm,
  ReleaseInventoryForm,
  ResolveDisputeForm,
} from "@/components/disputes/dispute-forms";
import { DisputeThread } from "@/components/disputes/dispute-section";
import { POSSESSION_LABELS } from "@/components/disputes/labels";
import { PageLoading } from "@/components/layout/page-loading";
import { requireRole } from "@/lib/auth/session";
import { getAdminDispute } from "@/lib/bookings/disputes";
import { PAYMENT_METHOD_LABELS } from "@/lib/bookings/handover";
import { formatInr } from "@/lib/utils";
import { uuidSchema } from "@/lib/validation/listing";

export const metadata: Metadata = { title: "Dispute · Admin" };

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

const NOTICES = {
  status: "Status updated. Both participants see it on their booking page.",
  resolved: "Resolution recorded and audited.",
  closed: "Resolution recorded and the booking closed by support. Amounts are recorded as owed, not paid.",
  opened: "Dispute opened on the participant’s behalf and audited.",
  released: "Inventory hold released. The provider can republish the listing.",
} as const;

async function AdminDisputePage({ params, searchParams }: PageProps<"/admin/disputes/[id]">) {
  const profile = await requireRole(["admin"]);
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const disputeId = uuidSchema.safeParse(id);
  if (!disputeId.success) notFound();

  const data = await getAdminDispute(disputeId.data, profile.id);
  if (data === null) {
    return (
      <DashboardShell profile={profile} title="Dispute">
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          The dispute could not be loaded. Please try again later.
        </p>
      </DashboardShell>
    );
  }
  if (data.notFound) notFound();
  const { dispute, otherDisputes, booking, product, renter, provider, exchanges, proposals, events, closure } = data;
  const noticeText = typeof notice === "string" && notice in NOTICES ? NOTICES[notice as keyof typeof NOTICES] : null;
  const itemOut = booking.status === "confirmed" && (booking.phase === "active" || booking.phase === "return_requested");

  return (
    <DashboardShell profile={profile} title="Dispute">
      <Link href="/admin/disputes" className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        All disputes
      </Link>
      {noticeText ? (
        <div className="mb-6">
          <FormMessage status="success" message={noticeText} />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="grid min-w-0 gap-6">
          <section aria-labelledby="dispute-heading" className="grid gap-4 rounded-xl border border-border bg-card p-6">
            <h2 id="dispute-heading" className="text-lg font-semibold">
              This dispute
            </h2>
            <DisputeThread dispute={dispute} viewerRole={null} bookingId={booking.id} canAct={false} />
          </section>

          {otherDisputes.length > 0 ? (
            <section aria-labelledby="other-heading" className="grid gap-3 rounded-xl border border-border bg-card p-6">
              <h2 id="other-heading" className="font-semibold">
                Other disputes on this booking ({otherDisputes.length})
              </h2>
              {otherDisputes.map((d) => (
                <div key={d.id} className="grid gap-1">
                  <DisputeThread dispute={d} viewerRole={null} bookingId={booking.id} canAct={false} />
                  <Link href={`/admin/disputes/${d.id}`} className="text-xs font-medium text-primary underline-offset-4 hover:underline">
                    Open this dispute
                  </Link>
                </div>
              ))}
            </section>
          ) : null}

          <section aria-labelledby="exchanges-heading" className="grid gap-4 rounded-xl border border-border bg-card p-6">
            <h2 id="exchanges-heading" className="font-semibold">
              Handover and return records (every version)
            </h2>
            {exchanges.length === 0 ? <p className="text-sm text-muted-foreground">No handover summary was shared.</p> : null}
            {exchanges.map((x) => (
              <article key={x.id} className="grid gap-2 rounded-lg border border-border p-4 text-sm">
                <p className="font-medium">
                  {x.kind === "handover" ? "Handover" : "Return"} version {x.revision}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {x.status === "current" ? "current" : "superseded"} · by the {x.created_by === booking.provider_id ? "provider" : "renter"} ·{" "}
                    {when.format(new Date(x.created_at))}
                  </span>
                </p>
                <p className="whitespace-pre-line wrap-break-word">{x.condition_notes}</p>
                <p className="text-xs text-muted-foreground">
                  Rent {formatInr(x.rent_amount)} · deposit {formatInr(x.deposit_amount)}
                  {x.kind === "return" ? ` · deduction ${formatInr(x.deduction_amount ?? 0)} · refund ${formatInr(x.refund_due ?? 0)}` : ""} ·{" "}
                  {PAYMENT_METHOD_LABELS[x.payment_method]}
                </p>
                {x.deduction_reason ? <p className="text-xs wrap-break-word">Deduction reason: {x.deduction_reason}</p> : null}
                {x.change_reason ? <p className="text-xs wrap-break-word">Correction: {x.change_reason}</p> : null}
                <p className="text-xs">
                  {x.confirmations.length === 0
                    ? "No confirmations."
                    : x.confirmations.map((c) => `${c.participant_role} confirmed ${when.format(new Date(c.confirmed_at))}`).join(" · ")}
                </p>
                {x.evidence.length > 0 ? (
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {x.evidence.map((e) => (
                      <li key={e.id} className="aspect-square overflow-hidden rounded-md bg-muted">
                        {e.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={e.url} alt={e.caption ?? "Condition photo"} className="size-full object-cover" loading="lazy" />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
            {proposals.length > 0 ? (
              <div className="grid gap-1 text-sm">
                <p className="font-medium">Return time proposals</p>
                {proposals.map((p) => (
                  <p key={p.id} className="text-xs text-muted-foreground">
                    v{p.version}: {when.format(new Date(p.proposed_at))} IST by the {p.proposer_role} · {p.status}
                  </p>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <div className="grid gap-6">
          <section aria-labelledby="booking-heading" className="grid gap-3 rounded-xl border border-border bg-card p-6 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 id="booking-heading" className="font-semibold wrap-break-word">
                <Link href={`/admin/listings/${product.id}`} className="underline-offset-4 hover:underline">
                  {product.title}
                </Link>
              </h2>
              <BookingStatusBadge status={booking.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              Phase: {booking.phase.replace("_", " ")} · Renter: {renter?.full_name ?? "unknown"}
              {renter?.account_status === "suspended" ? " (suspended)" : ""} · Provider: {provider?.full_name ?? "unknown"}
              {provider?.account_status === "suspended" ? " (suspended)" : ""}
            </p>
            <BookingQuote booking={booking} />
            {product.inventory_hold ? (
              <div className="grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200">
                <p className="font-medium">Inventory hold: item {product.inventory_hold}. The listing can’t be republished.</p>
                <ReleaseInventoryForm disputeId={dispute.id} productId={product.id} />
              </div>
            ) : null}
          </section>

          {closure ? (
            <section className="grid gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-900 dark:text-amber-200">
              <h2 className="font-semibold">Closed by support</h2>
              <p>Item: {POSSESSION_LABELS[closure.possession_outcome]}</p>
              <p>Provider owes renter (outstanding): {formatInr(closure.provider_owes_renter_outstanding)}</p>
              <p>Renter owes provider (outstanding): {formatInr(closure.renter_owes_provider_outstanding)}</p>
              <p className="text-xs">{when.format(new Date(closure.created_at))}</p>
            </section>
          ) : null}

          {dispute.status !== "resolved" ? (
            <>
              <section aria-labelledby="status-heading" className="grid gap-3 rounded-xl border border-border bg-card p-6">
                <h2 id="status-heading" className="font-semibold">
                  Review status
                </h2>
                <DisputeStatusForm key={dispute.status} disputeId={dispute.id} />
              </section>
              <section aria-labelledby="resolve-heading" className="grid gap-3 rounded-xl border border-border bg-card p-6">
                <h2 id="resolve-heading" className="font-semibold">
                  Resolve
                </h2>
                <p className="text-xs text-muted-foreground">
                  Your decision is shown to both participants and recorded in the activity log. It can’t be edited afterwards. The hold lifts
                  only when every open dispute on this booking is resolved.
                </p>
                <ResolveDisputeForm disputeId={dispute.id} possessionRequired={itemOut} />
              </section>
            </>
          ) : null}

          {booking.status === "confirmed" || booking.status === "completed" ? (
            <section className="grid gap-3 rounded-xl border border-border bg-card p-6">
              <OpenDisputeForParticipantForm bookingId={booking.id} />
            </section>
          ) : null}

          <section aria-labelledby="timeline-heading" className="rounded-xl border border-border bg-card p-6">
            <h2 id="timeline-heading" className="font-semibold">
              Booking timeline
            </h2>
            <ol className="mt-3 grid gap-2 text-xs">
              {events.map((e) => (
                <li key={e.id} className="grid gap-0.5">
                  <span className="font-medium">{e.event_type.replaceAll("_", " ")}</span>
                  {e.reason ? <span className="text-muted-foreground wrap-break-word">{e.reason}</span> : null}
                  <time dateTime={e.created_at} className="text-muted-foreground">
                    {when.format(new Date(e.created_at))}
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
export default function Page(props: PageProps<"/admin/disputes/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <AdminDisputePage {...props} />
    </Suspense>
  );
}
