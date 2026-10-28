// Zod schemas for provider listing input. The database functions repeat
// every check; this layer gives field-level messages before the RPC call.

import { z } from "zod";

import { PRODUCT_CATEGORIES, PRODUCT_CONDITIONS } from "@/lib/listings/options";

const line = (min: number, max: number, label: string) =>
  z
    .string()
    .transform((value) => value.replace(/[\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(min, min > 0 ? `${label} must be at least ${min} characters.` : undefined)
        .max(max, `${label} must be ${max} characters or fewer.`),
    );

const block = (min: number, max: number, label: string) =>
  z
    .string()
    .transform((value) =>
      value
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0001-\u0009\u000B-\u001F\u007F]/g, "")
        .trim(),
    )
    .pipe(
      z
        .string()
        .min(min, min > 0 ? `${label} must be at least ${min} characters.` : undefined)
        .max(max, `${label} must be ${max} characters or fewer.`),
    );

// Rupee amounts as exact decimal strings: no rounding, at most 2 places.
const rupees = (label: string, { min, max, allowZero }: { min: number; max: number; allowZero: boolean }) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,6}(\.\d{1,2})?$/, `Enter ${label} in rupees, with at most 2 decimal places.`)
    .refine((value) => {
      const amount = Number(value);
      return (allowZero ? amount >= min : amount > min) && amount <= max;
    }, `${label[0]?.toUpperCase()}${label.slice(1)} must be between ₹${min} and ₹${max.toLocaleString("en-IN")}.`);

const categoryValues = PRODUCT_CATEGORIES.map((c) => c.value) as [string, ...string[]];
const conditionValues = PRODUCT_CONDITIONS.map((c) => c.value) as [string, ...string[]];

export const listingSchema = z.object({
  title: line(3, 120, "Title"),
  description: block(0, 2000, "Description"),
  category: z.enum(categoryValues, { error: "Choose a category." }),
  condition: z.enum(conditionValues, { error: "Choose a condition." }),
  pricePerDay: rupees("the daily rate", { min: 0, max: 50000, allowZero: false }),
  deposit: rupees("the deposit", { min: 0, max: 500000, allowZero: true }),
  area: line(2, 80, "Area"),
  landmark: line(0, 120, "Landmark"),
  exactAddress: block(5, 500, "Pickup address"),
  pickupInstructions: block(0, 1000, "Pickup instructions"),
});

export type ListingInput = z.infer<typeof listingSchema>;

export const LISTING_FIELDS = [
  "title",
  "description",
  "category",
  "condition",
  "pricePerDay",
  "deposit",
  "area",
  "landmark",
  "exactAddress",
  "pickupInstructions",
] as const;

export const uuidSchema = z.uuid({ version: "v4" });

export const captionSchema = line(0, 200, "Caption");

export const LISTING_STATUS_OPERATIONS = ["submit", "pause", "resume", "archive"] as const;
export type ListingStatusOperation = (typeof LISTING_STATUS_OPERATIONS)[number];
export const statusOperationSchema = z.enum(LISTING_STATUS_OPERATIONS);
