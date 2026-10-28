// Browser-safe Gwalior date and price helpers. The database is authoritative
// for every check and amount; these only drive the form and its preview.

export const GWALIOR_TIME_ZONE = "Asia/Kolkata";
/** India has no daylight saving time, so the offset is fixed. */
export const GWALIOR_UTC_OFFSET = "+05:30";
export const MAX_RENTAL_DAYS = 180;
export const MAX_DAYS_AHEAD = 365;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Today's date in Gwalior as YYYY-MM-DD, whatever the viewer's time zone. */
export function gwaliorToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: GWALIOR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Real calendar date check (rejects 2026-02-30, 2027-02-29, etc.). */
export function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isValidTime(value: string): boolean {
  return TIME.test(value);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive day count: the same start and end date is one day. */
export function rentalDays(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/** A Gwalior wall-clock date and time as an ISO timestamp with offset. */
export function gwaliorTimestamp(date: string, time: string): string {
  return `${date}T${time}:00${GWALIOR_UTC_OFFSET}`;
}

/** Exact rupee maths in integer paise (no floating-point drift). */
export function quote(pricePerDay: number, deposit: number, days: number) {
  const pricePaise = Math.round(pricePerDay * 100);
  const depositPaise = Math.round(deposit * 100);
  const rentPaise = pricePaise * days;
  return { days, rent: rentPaise / 100, deposit: depositPaise / 100, total: (rentPaise + depositPaise) / 100 };
}

export type DateProblem =
  | "invalid"
  | "start_too_soon"
  | "start_too_far"
  | "end_before_start"
  | "rental_too_long"
  | "return_before_pickup";

/** Mirrors create_booking's rules for instant form feedback. */
export function checkDates(input: {
  start: string;
  end: string;
  pickupTime: string;
  returnTime: string;
  today: string;
}): DateProblem | null {
  const { start, end, pickupTime, returnTime, today } = input;
  if (!isValidDate(start) || !isValidDate(end) || !isValidTime(pickupTime) || !isValidTime(returnTime)) return "invalid";
  if (start < addDays(today, 1)) return "start_too_soon";
  if (start > addDays(today, MAX_DAYS_AHEAD)) return "start_too_far";
  if (end < start) return "end_before_start";
  if (rentalDays(start, end) > MAX_RENTAL_DAYS) return "rental_too_long";
  if (start === end && returnTime <= pickupTime) return "return_before_pickup";
  return null;
}

/** Collapses sorted YYYY-MM-DD dates into inclusive ranges for display. */
export function toRanges(dates: string[]): { start: string; end: string }[] {
  const ranges: { start: string; end: string }[] = [];
  for (const date of [...dates].sort()) {
    const last = ranges.at(-1);
    if (last && addDays(last.end, 1) === date) last.end = date;
    else ranges.push({ start: date, end: date });
  }
  return ranges;
}

export function overlapsRanges(start: string, end: string, ranges: { start: string; end: string }[]): boolean {
  return ranges.some((r) => start <= r.end && end >= r.start);
}
