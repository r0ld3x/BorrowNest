import { cn, formatInr } from "@/lib/utils";
import type { BookingStatus } from "@/types/database";

const STATUS: Record<BookingStatus, { label: string; className: string }> = {
  pending: { label: "Pending – not reserved", className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  confirmed: { label: "Confirmed", className: "border-primary/40 bg-accent text-accent-foreground" },
  rejected: { label: "Declined", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  cancelled: { label: "Cancelled", className: "border-border bg-muted text-muted-foreground" },
  completed: { label: "Completed", className: "border-border bg-muted text-foreground" },
  closed: { label: "Closed by support", className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300" },
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const s = STATUS[status];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-xs font-medium", s.className)}>{s.label}</span>
  );
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const shortDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** Formats a YYYY-MM-DD calendar date (no time-zone shift). */
export function formatDay(date: string, style: "long" | "short" = "long") {
  return (style === "long" ? dateFmt : shortDate).format(new Date(`${date}T12:00:00+05:30`));
}

export function formatTime(timestamp: string) {
  return timeFmt.format(new Date(timestamp));
}

export interface BookingTermsView {
  start_date: string;
  end_date: string;
  pickup_at: string;
  return_at: string;
  rental_days: number;
  price_per_day: number;
  deposit: number;
  rental_amount: number;
  total_due: number;
}

/** The saved database quote, never a browser-side calculation. */
export function BookingQuote({ booking }: { booking: BookingTermsView }) {
  return (
    <dl className="grid gap-2 text-sm">
      <div className="flex flex-wrap justify-between gap-x-3">
        <dt className="text-muted-foreground">Pickup</dt>
        <dd>
          {formatDay(booking.start_date)} · {formatTime(booking.pickup_at)}
        </dd>
      </div>
      <div className="flex flex-wrap justify-between gap-x-3">
        <dt className="text-muted-foreground">Return</dt>
        <dd>
          {formatDay(booking.end_date)} · {formatTime(booking.return_at)}
        </dd>
      </div>
      <div className="flex justify-between gap-3 border-t border-border pt-2">
        <dt className="text-muted-foreground">
          {formatInr(booking.price_per_day)} × {booking.rental_days} {booking.rental_days === 1 ? "day" : "days"}
        </dt>
        <dd className="tabular-nums">{formatInr(booking.rental_amount)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">Refundable deposit</dt>
        <dd className="tabular-nums">{formatInr(booking.deposit)}</dd>
      </div>
      <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold">
        <dt>Total due at pickup (offline)</dt>
        <dd className="tabular-nums">{formatInr(booking.total_due)}</dd>
      </div>
    </dl>
  );
}
