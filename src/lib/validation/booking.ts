// Zod boundary for booking requests. create_booking re-checks every rule in
// the database, and never accepts prices, ids of participants, or status.

import { z } from "zod";

import { isValidDate, isValidTime } from "@/lib/bookings/dates";

const date = z.string().refine(isValidDate, "Choose a valid date.");
const time = z.string().refine(isValidTime, "Choose a valid time.");

export const bookingRequestSchema = z.object({
  productId: z.uuid({ version: "v4" }),
  startDate: date,
  endDate: date,
  pickupTime: time,
  returnTime: time,
  note: z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").replace(/[\u0001-\u0009\u000B-\u001F\u007F]/g, "").trim())
    .pipe(z.string().max(500, "Keep the note to 500 characters or fewer.")),
  requestKey: z.uuid({ version: "v4" }),
});

export const BOOKING_REQUEST_FIELDS = ["productId", "startDate", "endDate", "pickupTime", "returnTime", "note", "requestKey"] as const;
