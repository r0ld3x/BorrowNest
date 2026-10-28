import { CheckCircle2Icon, GavelIcon, MessageSquareIcon, ShieldAlertIcon } from "lucide-react";

import { DisputeEvidenceForm, DisputeMessageForm, OpenDisputeForm } from "@/components/disputes/dispute-forms";
import { CATEGORY_LABELS, DECISION_LABELS, POSSESSION_LABELS, STATUS_LABELS } from "@/components/disputes/labels";
import type { DisputeView } from "@/lib/bookings/disputes";
import { cn, formatInr } from "@/lib/utils";
import type { BookingStatus, DisputeStatus, ParticipantRole } from "@/types/database";

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

const STATUS_STYLE: Record<DisputeStatus, string> = {
  open: "border-destructive/40 bg-destructive/10 text-destructive",
  in_review: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  needs_info: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  resolved: "border-border bg-muted text-foreground",
};

export function DisputeStatusBadge({ status }: { status: DisputeStatus }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-xs font-medium", STATUS_STYLE[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function who(role: string, viewerRole: string | null) {
  if (role === viewerRole) return "You";
  if (role === "admin") return "BorrowNest support";
  return role === "renter" ? "The renter" : "The provider";
}

/** One dispute: opening statement, statements in order, photos, and the admin resolution. */
export function DisputeThread({
  dispute,
  viewerRole,
  bookingId,
  canAct,
}: {
  dispute: DisputeView;
  viewerRole: ParticipantRole | null;
  bookingId: string;
  canAct: boolean;
}) {
  const r = dispute.resolution;
  const opener =
    dispute.opened_by_role === viewerRole
      ? "you"
      : dispute.opened_by_role === "admin"
        ? `BorrowNest support, for the ${dispute.on_behalf_of}`
        : `the ${dispute.opened_by_role}`;
  return (
    <article id={`dispute-${dispute.id}`} className="grid gap-3 rounded-lg border border-border p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{CATEGORY_LABELS[dispute.category]}</h3>
          <p className="text-xs text-muted-foreground">
            Opened by {opener} · {when.format(new Date(dispute.created_at))}
            {dispute.post_completion ? " · after completion (support case)" : ""}
          </p>
        </div>
        <DisputeStatusBadge status={dispute.status} />
      </div>
      <p className="whitespace-pre-line wrap-break-word">{dispute.description}</p>

      {dispute.messages.length > 0 ? (
        <ol className="grid gap-2 border-l-2 border-border pl-3">
          {dispute.messages.map((m) => (
            <li key={m.id} className={cn("grid gap-0.5", m.author_role === "admin" && "rounded-md bg-accent px-2 py-1.5 text-accent-foreground")}>
              <p className="text-xs text-muted-foreground">
                <MessageSquareIcon aria-hidden="true" className="mr-1 inline size-3" />
                {who(m.author_role, viewerRole)}
                {m.kind === "info_request" ? " asked for information" : m.kind === "status_note" ? " (status note)" : ""} ·{" "}
                {when.format(new Date(m.created_at))}
              </p>
              <p className="whitespace-pre-line wrap-break-word">{m.body}</p>
            </li>
          ))}
        </ol>
      ) : null}

      {dispute.evidence.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {dispute.evidence.map((e) => (
            <li key={e.id} className="grid gap-1">
              <div className="aspect-square overflow-hidden rounded-lg bg-muted">
                {e.url ? (
                  // Short-lived signed URL for a private object; not optimised through next/image.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.url} alt={e.caption ?? "Dispute photo"} className="size-full object-cover" loading="lazy" />
                ) : (
                  <p className="p-3 text-xs text-muted-foreground">Photo unavailable. Reload the page.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground wrap-break-word">
                {e.caption ? `${e.caption} · ` : ""}
                {e.uploadedByYou ? "added by you" : `added by the ${e.uploaderRole}`}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {r ? (
        <div className="grid gap-2 rounded-lg border border-primary/40 bg-accent p-3 text-accent-foreground">
          <p className="flex items-center gap-2 font-semibold">
            <GavelIcon aria-hidden="true" className="size-4" />
            Admin resolved: {DECISION_LABELS[r.decision]}
          </p>
          <p className="whitespace-pre-line wrap-break-word">{r.reason}</p>
          {r.acknowledged_facts ? <p className="text-xs whitespace-pre-line wrap-break-word">Facts considered: {r.acknowledged_facts}</p> : null}
          <dl className="grid gap-1 text-xs">
            {r.possession_outcome !== "not_applicable" ? (
              <div className="flex flex-wrap justify-between gap-x-3">
                <dt>Item</dt>
                <dd>{POSSESSION_LABELS[r.possession_outcome]}</dd>
              </div>
            ) : null}
            {r.provider_owes_renter > 0 ? (
              <div className="flex flex-wrap justify-between gap-x-3">
                <dt>Provider owes the renter</dt>
                <dd className="tabular-nums">{formatInr(r.provider_owes_renter)}</dd>
              </div>
            ) : null}
            {r.renter_owes_provider > 0 ? (
              <div className="flex flex-wrap justify-between gap-x-3">
                <dt>Renter owes the provider</dt>
                <dd className="tabular-nums">{formatInr(r.renter_owes_provider)}</dd>
              </div>
            ) : null}
          </dl>
          {r.obligation_note ? <p className="text-xs wrap-break-word">{r.obligation_note}</p> : null}
          {r.provider_owes_renter > 0 || r.renter_owes_provider > 0 ? (
            <p className="text-xs">
              These amounts are owed, not paid. BorrowNest can’t move money; settle them offline between you.
            </p>
          ) : null}
          <p className="text-xs">Decided {when.format(new Date(r.created_at))} by BorrowNest support.</p>
        </div>
      ) : null}

      {canAct && dispute.status !== "resolved" ? (
        <div className="grid gap-4 border-t border-border pt-3">
          <DisputeMessageForm bookingId={bookingId} disputeId={dispute.id} />
          {dispute.evidence.length < 10 ? <DisputeEvidenceForm bookingId={bookingId} disputeId={dispute.id} /> : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Disputes for one booking, visible only to its participants (and admins).
 * While any non-post-completion dispute is unresolved, the booking is held.
 */
export function DisputeSection({
  bookingId,
  bookingStatus,
  viewerRole,
  disputes,
  closure,
  completionWindowEnds,
  now,
}: {
  bookingId: string;
  bookingStatus: BookingStatus;
  viewerRole: ParticipantRole;
  disputes: DisputeView[];
  closure: { possession_outcome: string; provider_owes_renter_outstanding: number; renter_owes_provider_outstanding: number; reason: string; created_at: string } | null;
  completionWindowEnds: string | null;
  now: number;
}) {
  const holding = disputes.filter((d) => d.status !== "resolved" && !d.post_completion);
  const windowOpen = bookingStatus === "completed" && completionWindowEnds !== null && now <= new Date(completionWindowEnds).getTime();
  const canOpen = bookingStatus === "confirmed" || windowOpen;

  return (
    <section id="disputes" aria-labelledby="disputes-heading" className="grid gap-4 rounded-xl border border-border bg-card p-6">
      <h2 id="disputes-heading" className="flex items-center gap-2 text-lg font-semibold">
        <ShieldAlertIcon aria-hidden="true" className="size-5" />
        Disputes
      </h2>

      {closure ? (
        <div className="grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-semibold">Admin resolved: closed by BorrowNest support</p>
          <p>
            This booking was closed by support, not completed by both of you. Item: {POSSESSION_LABELS[closure.possession_outcome as keyof typeof POSSESSION_LABELS]}.
          </p>
          <p className="whitespace-pre-line wrap-break-word">{closure.reason}</p>
          <ul className="grid gap-0.5 text-xs">
            <li>Provider still owes the renter: {formatInr(closure.provider_owes_renter_outstanding)}</li>
            <li>Renter still owes the provider: {formatInr(closure.renter_owes_provider_outstanding)}</li>
          </ul>
          <p className="text-xs">Outstanding means owed, not paid. BorrowNest did not move any money. Closed {when.format(new Date(closure.created_at))}.</p>
        </div>
      ) : bookingStatus === "completed" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2Icon aria-hidden="true" className="size-4" />
          Both parties confirmed the return.
          {windowOpen && completionWindowEnds ? ` You can open a support case until ${when.format(new Date(completionWindowEnds))}.` : ""}
        </p>
      ) : holding.length > 0 ? (
        <p role="status" className="text-sm text-destructive">
          On hold: handover and return confirmations are paused until every open dispute is resolved by BorrowNest support.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          If something goes wrong with the handover, payment, condition, return or refund, open a dispute. It pauses confirmations until
          BorrowNest support decides. Don’t confirm anything you disagree with.
        </p>
      )}

      {disputes.length === 0 ? <p className="text-sm text-muted-foreground">No disputes on this booking.</p> : null}
      {disputes.map((d) => (
        <DisputeThread key={d.id} dispute={d} viewerRole={viewerRole} bookingId={bookingId} canAct={bookingStatus !== "closed"} />
      ))}

      {canOpen ? <OpenDisputeForm bookingId={bookingId} holds={bookingStatus === "confirmed"} /> : null}
    </section>
  );
}
