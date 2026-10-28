import { CalendarClockIcon, CheckCircle2Icon, ClockIcon, ReceiptTextIcon, Undo2Icon } from "lucide-react";

import { ConfirmHandoverForm } from "@/components/bookings/handover-forms";
import { ConfirmationCard, EvidenceGallery } from "@/components/bookings/handover-panel";
import { AcceptReturnForm, PrepareReturnForm, ProposeReturnForm, ReviseReturnForm } from "@/components/bookings/return-forms";
import { addDays, gwaliorToday } from "@/lib/bookings/dates";
import { type HandoverView, MAX_EVIDENCE, PAYMENT_METHOD_LABELS, type ReturnProposal } from "@/lib/bookings/handover";
import { paiseToDecimal } from "@/lib/bookings/settlement";
import { formatInr } from "@/lib/utils";
import type { ParticipantRole, RentalPhase } from "@/types/database";

const ist = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const istLong = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const istDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

export interface ReturnBooking {
  id: string;
  product_title: string;
  status: string;
  phase: RentalPhase;
  return_at: string;
  deposit: number;
  rental_amount: number;
}

export interface ReturnSchedule {
  proposals: ReturnProposal[];
  current: ReturnProposal | null;
  latestVersion: number;
  overdue: boolean;
}

const paise = (rupees: number) => Math.round(rupees * 100);

function returnStatements(role: ParticipantRole, title: string, deduction: number, refund: number, method: string) {
  const settlement =
    refund === 0
      ? `no deposit refund (${formatInr(deduction)} kept from the deposit)`
      : deduction === 0
        ? `the full deposit refund of ${formatInr(refund)} by ${method}`
        : `a deposit refund of ${formatInr(refund)} by ${method} (${formatInr(deduction)} deducted)`;
  return role === "renter"
    ? [
        { key: "returned_item", label: `I have handed the ${title} back to the provider.` },
        { key: "settlement_agreed", label: "I agree with the return condition notes, photos and deposit deduction above." },
        { key: "refund_received", label: refund === 0 ? `I agree to ${settlement}.` : `I received ${settlement}.` },
      ]
    : [
        { key: "received_item", label: `I have received the ${title} back from the renter.` },
        { key: "condition_matches", label: "The return condition notes and photos above match the item as I received it." },
        { key: "refund_paid", label: refund === 0 ? `I confirm ${settlement}.` : `I paid ${settlement}.` },
      ];
}

/**
 * Return scheduling, the shared settlement summary, both acknowledgements and
 * the completion receipt. The booking completes only when both confirm.
 */
export function ReturnPanel({
  booking,
  schedule,
  returnView,
  viewerRole,
  viewerId,
  openIssues,
}: {
  booking: ReturnBooking;
  schedule: ReturnSchedule;
  returnView: HandoverView;
  viewerRole: ParticipantRole;
  viewerId: string;
  openIssues: number;
}) {
  const otherRole: ParticipantRole = viewerRole === "renter" ? "provider" : "renter";
  const current = returnView.current;
  const completed = booking.status === "completed";
  const accepted = schedule.proposals.find((p) => p.status === "accepted") ?? null;
  const pending = schedule.current?.status === "pending" ? schedule.current : null;
  const mine = returnView.confirmations.find((c) => c.participant_role === viewerRole);
  const theirs = returnView.confirmations.find((c) => c.participant_role === otherRole);
  const returnOpen = booking.status === "confirmed" && booking.phase === "return_requested";

  // Date bounds for the picker; the database enforces the same rules.
  const today = gwaliorToday();
  const minDate = today;
  const maxDate = schedule.overdue ? addDays(today, 7) : istDate.format(new Date(booking.return_at));
  const proposerLabel = (p: ReturnProposal) => (p.proposed_by === viewerId ? "you" : `the ${p.proposer_role}`);

  return (
    <section aria-labelledby="return-heading" className="grid gap-5 rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="return-heading" className="flex items-center gap-2 text-lg font-semibold">
          <Undo2Icon aria-hidden="true" className="size-5" />
          Return
        </h2>
        {current ? <span className="text-xs text-muted-foreground">Version {current.revision}</span> : null}
      </div>

      <dl className="grid gap-2 text-sm">
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="text-muted-foreground">Original return time</dt>
          <dd>{istLong.format(new Date(booking.return_at))} IST</dd>
        </div>
        {accepted ? (
          <div className="flex flex-wrap justify-between gap-x-3">
            <dt className="text-muted-foreground">Agreed return time</dt>
            <dd className="font-medium">{istLong.format(new Date(accepted.proposed_at))} IST</dd>
          </div>
        ) : null}
      </dl>

      {schedule.overdue && !completed ? (
        <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Overdue: the original return time has passed. The booking is not extended. Arrange the return within the next 7 days and record it
          here, or report an issue above for BorrowNest support.
        </p>
      ) : null}

      {completed && current ? (
        <div className="grid gap-4 rounded-lg border border-primary/40 bg-accent p-4 text-sm text-accent-foreground">
          <p className="flex items-center gap-2 font-semibold">
            <ReceiptTextIcon aria-hidden="true" className="size-4" />
            Rental completed · both parties confirmed
          </p>
          <dl className="grid gap-1">
            <div className="flex justify-between gap-3">
              <dt>Rent (unchanged)</dt>
              <dd className="tabular-nums">{formatInr(booking.rental_amount)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Deposit</dt>
              <dd className="tabular-nums">{formatInr(current.deposit_amount)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Deduction</dt>
              <dd className="tabular-nums">− {formatInr(current.deduction_amount ?? 0)}</dd>
            </div>
            {current.deduction_reason ? <dd className="text-xs wrap-break-word">Reason: {current.deduction_reason}</dd> : null}
            <div className="flex justify-between gap-3 border-t border-primary/30 pt-1 font-semibold">
              <dt>Refund to the renter</dt>
              <dd className="tabular-nums">
                {formatInr(current.refund_due ?? 0)} · {PAYMENT_METHOD_LABELS[current.payment_method]}
              </dd>
            </div>
          </dl>
          <ul className="grid gap-1 text-xs">
            {returnView.confirmations.map((c) => (
              <li key={c.participant_role} className="flex items-center gap-1.5">
                <CheckCircle2Icon aria-hidden="true" className="size-3.5" />
                {c.participant_role === viewerRole ? "You" : `The ${c.participant_role}`} confirmed {istLong.format(new Date(c.confirmed_at))}
              </li>
            ))}
          </ul>
          <p className="text-xs">
            This receipt records what you both acknowledged. The rent, deposit and refund were paid offline; BorrowNest did not hold or
            verify any money.
          </p>
        </div>
      ) : null}

      {/* Scheduling --------------------------------------------------------- */}
      {booking.phase === "active" && booking.status === "confirmed" ? (
        pending ? (
          <div className="grid gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              <CalendarClockIcon aria-hidden="true" className="size-4" />
              {istLong.format(new Date(pending.proposed_at))} IST
            </p>
            <p className="text-muted-foreground">
              Proposed by {proposerLabel(pending)}
              {pending.note ? <span className="wrap-break-word"> · “{pending.note}”</span> : null}
            </p>
            {pending.proposed_by === viewerId ? (
              <p className="flex items-center gap-2 text-muted-foreground" role="status">
                <ClockIcon aria-hidden="true" className="size-4" />
                Waiting for the {otherRole} to accept or suggest another time.
              </p>
            ) : (
              <AcceptReturnForm key={pending.id} bookingId={booking.id} proposalId={pending.id} when={ist.format(new Date(pending.proposed_at))} />
            )}
            <ProposeReturnForm
              key={`counter-${pending.id}`}
              bookingId={booking.id}
              expectedVersion={schedule.latestVersion}
              minDate={minDate}
              maxDate={maxDate}
              label={pending.proposed_by === viewerId ? "Change my proposal" : "Suggest another time"}
              collapsed
            />
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              When you’re ready, agree when the item goes back. Either of you can propose a time at or before the original return time;
              the other accepts it or suggests another.
            </p>
            <ProposeReturnForm
              key={`propose-${schedule.latestVersion}`}
              bookingId={booking.id}
              expectedVersion={schedule.latestVersion}
              minDate={minDate}
              maxDate={maxDate}
              label="Propose a return time"
            />
          </div>
        )
      ) : null}

      {/* Return summary ------------------------------------------------------ */}
      {returnOpen && !current ? (
        viewerRole === "provider" ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              When the item is back, record its condition and the deposit settlement you agreed. The renter reviews the same summary and the
              rental completes once you both confirm.
            </p>
            <PrepareReturnForm bookingId={booking.id} depositPaise={paise(booking.deposit)} />
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <ClockIcon aria-hidden="true" className="size-4" />
            At the agreed time, the provider checks the item and shares a return summary here for you to confirm.
          </p>
        )
      ) : null}
      {returnOpen && !current ? (
        <ProposeReturnForm
          key={`resched-${schedule.latestVersion}`}
          bookingId={booking.id}
          expectedVersion={schedule.latestVersion}
          minDate={minDate}
          maxDate={maxDate}
          label="Suggest a different time"
          collapsed
        />
      ) : null}

      {current && !completed ? (
        <>
          <dl className="grid gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <div className="grid gap-1">
              <dt className="font-medium">Condition when returned</dt>
              <dd className="whitespace-pre-line text-muted-foreground wrap-break-word">{current.condition_notes}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-3">
              <dt className="text-muted-foreground">Deposit (from the booking)</dt>
              <dd className="tabular-nums">{formatInr(current.deposit_amount)}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-3">
              <dt className="text-muted-foreground">Agreed deduction</dt>
              <dd className="tabular-nums">− {formatInr(current.deduction_amount ?? 0)}</dd>
            </div>
            {current.deduction_reason ? (
              <div className="grid gap-1">
                <dt className="text-muted-foreground">Reason</dt>
                <dd className="whitespace-pre-line wrap-break-word">{current.deduction_reason}</dd>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-between gap-x-3 border-t border-border pt-2 font-semibold">
              <dt>Refund due to the renter</dt>
              <dd className="tabular-nums">{formatInr(current.refund_due ?? 0)}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-3">
              <dt className="text-muted-foreground">Refund paid by</dt>
              <dd>{PAYMENT_METHOD_LABELS[current.payment_method]}</dd>
            </div>
            {current.change_reason ? (
              <div className="grid gap-1 border-t border-border pt-3">
                <dt className="font-medium">Correction in this version</dt>
                <dd className="whitespace-pre-line text-muted-foreground wrap-break-word">{current.change_reason}</dd>
              </div>
            ) : null}
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              Rent stays {formatInr(booking.rental_amount)} even for an early return. Additional claims beyond the deposit need a dispute.
            </p>
          </dl>

          <EvidenceGallery
            evidence={returnView.evidence}
            otherRole={otherRole}
            upload={returnOpen && returnView.evidence.length < MAX_EVIDENCE ? { bookingId: booking.id, exchangeId: current.id } : null}
          />

          <div className="grid gap-3">
            <h3 className="text-sm font-semibold">Confirmations for version {current.revision}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <ConfirmationCard who="You" confirmedAt={mine?.confirmed_at} />
              <ConfirmationCard who={otherRole === "provider" ? "Provider" : "Renter"} confirmedAt={theirs?.confirmed_at} />
            </div>
          </div>

          {returnOpen && !mine && openIssues === 0 ? (
            <ConfirmHandoverForm
              key={current.id}
              kind="return"
              bookingId={booking.id}
              exchangeId={current.id}
              revision={current.revision}
              settlement={{
                deduction: paiseToDecimal(paise(current.deduction_amount ?? 0)),
                refund: paiseToDecimal(paise(current.refund_due ?? 0)),
              }}
              statements={returnStatements(
                viewerRole,
                booking.product_title,
                current.deduction_amount ?? 0,
                current.refund_due ?? 0,
                PAYMENT_METHOD_LABELS[current.payment_method],
              )}
            />
          ) : returnOpen && openIssues > 0 ? (
            <p className="text-sm text-muted-foreground">Confirmation is on hold while an issue is open.</p>
          ) : returnOpen && mine && !theirs ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <ClockIcon aria-hidden="true" className="size-4" />
              Waiting for the {otherRole} to confirm this version. The rental completes when they do.
            </p>
          ) : null}

          {returnOpen ? (
            <ReviseReturnForm
              key={`revise-${current.id}`}
              bookingId={booking.id}
              exchangeId={current.id}
              revision={current.revision}
              depositPaise={paise(current.deposit_amount)}
              current={{
                conditionNotes: current.condition_notes,
                deduction: paiseToDecimal(paise(current.deduction_amount ?? 0)),
                deductionReason: current.deduction_reason ?? "",
                refundMethod: current.payment_method,
              }}
            />
          ) : null}
          {returnOpen ? (
            <p className="text-xs text-muted-foreground">Disagree with the summary? Request a correction, or report an issue above. Nothing closes until you both confirm.</p>
          ) : null}
        </>
      ) : null}

      {returnView.superseded.length > 0 ? (
        <details className="text-sm">
          <summary className="font-medium">Earlier return summaries ({returnView.superseded.length})</summary>
          <ol className="mt-2 grid gap-2">
            {returnView.superseded.map((x) => (
              <li key={x.id} className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  Version {x.revision} · deduction {formatInr(x.deduction_amount ?? 0)} · refund {formatInr(x.refund_due ?? 0)}
                </p>
                <p className="mt-1 whitespace-pre-line wrap-break-word">{x.condition_notes}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {schedule.proposals.length > 0 ? (
        <details className="text-sm">
          <summary className="font-medium">Return time history ({schedule.proposals.length})</summary>
          <ol className="mt-2 grid gap-1">
            {schedule.proposals.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-x-3 text-muted-foreground">
                <span>
                  {istLong.format(new Date(p.proposed_at))} IST · by {proposerLabel(p)}
                </span>
                <span>{p.status === "accepted" ? "Accepted" : p.status === "pending" ? "Waiting" : "Replaced"}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
