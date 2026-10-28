import { CheckCircle2Icon, ClockIcon, HandshakeIcon, ImageIcon, PauseCircleIcon } from "lucide-react";

import {
  ConfirmHandoverForm,
  EvidenceUploadForm,
  PrepareHandoverForm,
  ReviseHandoverForm,
} from "@/components/bookings/handover-forms";
import { type HandoverView, MAX_EVIDENCE, PAYMENT_METHOD_LABELS } from "@/lib/bookings/handover";
import { formatInr } from "@/lib/utils";
import type { ParticipantRole, RentalPhase } from "@/types/database";

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export interface HandoverBooking {
  id: string;
  product_title: string;
  status: string;
  phase: RentalPhase;
  return_at: string;
}

function statementsFor(role: ParticipantRole, title: string, rent: number, deposit: number, method: string) {
  const money = `${formatInr(rent)} rent and ${formatInr(deposit)} refundable deposit`;
  return role === "renter"
    ? [
        { key: "received_item", label: `I have received the ${title}.` },
        { key: "condition_agreed", label: "The item’s condition matches the notes and photos above." },
        { key: "paid_amounts", label: `I paid the provider ${money} by ${method}.` },
      ]
    : [
        { key: "handed_over_item", label: `I have handed the ${title} to the renter.` },
        { key: "condition_matches", label: "The notes and photos above match the item as I handed it over." },
        { key: "received_amounts", label: `I received ${money} by ${method}.` },
      ];
}

export function ConfirmationCard({ who, confirmedAt }: { who: string; confirmedAt: string | undefined }) {
  return (
    <div className="grid gap-1 rounded-lg border border-border p-3 text-sm">
      <p className="font-medium">{who}</p>
      {confirmedAt ? (
        <p className="flex items-center gap-1.5 text-primary">
          <CheckCircle2Icon aria-hidden="true" className="size-4" />
          Confirmed {when.format(new Date(confirmedAt))}
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <ClockIcon aria-hidden="true" className="size-4" />
          Not confirmed yet
        </p>
      )}
    </div>
  );
}

/** Private condition photos shown through short-lived signed URLs. */
export function EvidenceGallery({
  evidence,
  otherRole,
  upload,
}: {
  evidence: HandoverView["evidence"];
  otherRole: ParticipantRole;
  upload: { bookingId: string; exchangeId: string } | null;
}) {
  return (
    <div className="grid gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <ImageIcon aria-hidden="true" className="size-4" />
        Condition photos
      </h3>
      {evidence.length === 0 ? (
        <p className="text-sm text-muted-foreground">No photos yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {evidence.map((e) => (
            <li key={e.id} className="grid gap-1">
              <div className="aspect-square overflow-hidden rounded-lg bg-muted">
                {e.url ? (
                  // Short-lived signed URL for a private object; not optimised through next/image.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.url} alt={e.caption ?? "Condition photo"} className="size-full object-cover" loading="lazy" />
                ) : (
                  <p className="p-3 text-xs text-muted-foreground">Photo unavailable. Reload the page.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground wrap-break-word">
                {e.caption ? `${e.caption} · ` : ""}
                {e.uploadedByYou ? "added by you" : `added by the ${otherRole}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      {upload ? <EvidenceUploadForm bookingId={upload.bookingId} exchangeId={upload.exchangeId} /> : null}
      {evidence.length > 0 ? <p className="text-xs text-muted-foreground">Photo links expire after 10 minutes; reload to see them again.</p> : null}
    </div>
  );
}

/**
 * Handover summary for one participant. What each person ticks is their own
 * acknowledgement; BorrowNest records it but does not verify any payment.
 */
export function HandoverPanel({
  booking,
  handover,
  viewerRole,
}: {
  booking: HandoverBooking;
  handover: HandoverView;
  viewerRole: ParticipantRole;
}) {
  const { current, confirmations, evidence, holds } = handover;
  const otherRole: ParticipantRole = viewerRole === "renter" ? "provider" : "renter";
  const mine = confirmations.find((c) => c.participant_role === viewerRole);
  const theirs = confirmations.find((c) => c.participant_role === otherRole);
  const active = booking.phase !== "awaiting_handover";
  const expired = !active && handover.expired;
  const open = booking.status === "confirmed" && !active && !expired;

  return (
    <section aria-labelledby="handover-heading" className="grid gap-5 rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="handover-heading" className="flex items-center gap-2 text-lg font-semibold">
          <HandshakeIcon aria-hidden="true" className="size-5" />
          Handover
        </h2>
        {current ? <span className="text-xs text-muted-foreground">Version {current.revision}</span> : null}
      </div>

      {active ? (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-primary/40 bg-accent px-4 py-3 text-sm text-accent-foreground">
          <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>
            <span className="font-semibold">Handover complete.</span> You both confirmed the same handover summary.
          </p>
        </div>
      ) : expired ? (
        <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          The scheduled return time has passed without a confirmed handover. This booking needs BorrowNest support; open a dispute below.
        </p>
      ) : null}

      {holds.length > 0 && !active ? (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <PauseCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          On hold: {holds.length === 1 ? "a dispute is" : `${holds.length} disputes are`} open. Neither of you can confirm until BorrowNest
          support resolves {holds.length === 1 ? "it" : "them all"}. See Disputes below.
        </p>
      ) : null}

      {!current ? (
        viewerRole === "provider" && open ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              When you meet the renter, write down the item’s condition and how they’re paying. They review the same summary, and the
              rental starts once you both confirm it.
            </p>
            <PrepareHandoverForm bookingId={booking.id} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {open
              ? "At pickup, the provider shares a handover summary here. You’ll both confirm the item’s condition and the offline payment."
              : "No handover summary was shared."}
          </p>
        )
      ) : (
        <>
          <dl className="grid gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <div className="grid gap-1">
              <dt className="font-medium">Condition notes</dt>
              <dd className="whitespace-pre-line text-muted-foreground wrap-break-word">{current.condition_notes}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-3">
              <dt className="text-muted-foreground">Rent (from the booking)</dt>
              <dd className="tabular-nums">{formatInr(current.rent_amount)}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-3">
              <dt className="text-muted-foreground">Refundable deposit</dt>
              <dd className="tabular-nums">{formatInr(current.deposit_amount)}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-3">
              <dt className="text-muted-foreground">Paid offline by</dt>
              <dd>{PAYMENT_METHOD_LABELS[current.payment_method]}</dd>
            </div>
            {current.change_reason ? (
              <div className="grid gap-1 border-t border-border pt-3">
                <dt className="font-medium">Correction in this version</dt>
                <dd className="whitespace-pre-line text-muted-foreground wrap-break-word">{current.change_reason}</dd>
              </div>
            ) : null}
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              Amounts are what you both acknowledge. BorrowNest does not hold deposits or verify cash, UPI or bank transfers.
            </p>
          </dl>

          <EvidenceGallery
            evidence={evidence}
            otherRole={otherRole}
            upload={open && evidence.length < MAX_EVIDENCE ? { bookingId: booking.id, exchangeId: current.id } : null}
          />

          <div className="grid gap-3">
            <h3 className="text-sm font-semibold">Confirmations for version {current.revision}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <ConfirmationCard who="You" confirmedAt={mine?.confirmed_at} />
              <ConfirmationCard who={otherRole === "provider" ? "Provider" : "Renter"} confirmedAt={theirs?.confirmed_at} />
            </div>
          </div>

          {open && !mine && holds.length === 0 ? (
            <ConfirmHandoverForm
              key={current.id}
              bookingId={booking.id}
              exchangeId={current.id}
              revision={current.revision}
              statements={statementsFor(
                viewerRole,
                booking.product_title,
                current.rent_amount,
                current.deposit_amount,
                PAYMENT_METHOD_LABELS[current.payment_method],
              )}
            />
          ) : open && mine && !theirs ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <ClockIcon aria-hidden="true" className="size-4" />
              Waiting for the {otherRole} to confirm this version. The rental starts when they do.
            </p>
          ) : null}

          {open ? (
            <ReviseHandoverForm
              key={`revise-${current.id}`}
              bookingId={booking.id}
              exchangeId={current.id}
              revision={current.revision}
              conditionNotes={current.condition_notes}
              paymentMethod={current.payment_method}
            />
          ) : null}

          {handover.superseded.length > 0 ? (
            <details className="text-sm">
              <summary className="font-medium">Earlier versions ({handover.superseded.length})</summary>
              <ol className="mt-2 grid gap-2">
                {handover.superseded.map((x) => (
                  <li key={x.id} className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">
                      Version {x.revision} · {PAYMENT_METHOD_LABELS[x.payment_method]} · replaced{" "}
                      {x.superseded_at ? when.format(new Date(x.superseded_at)) : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-line wrap-break-word">{x.condition_notes}</p>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </>
      )}

    </section>
  );
}
