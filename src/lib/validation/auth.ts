// Zod schemas for auth forms. The server always re-validates with these;
// any client-side checks are only for convenience.

import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long.")
  .pipe(z.email("Enter a valid email address."));

// bcrypt (used by Supabase Auth) ignores bytes past 72.
const newPassword = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Use 72 characters or fewer.");

export const fullNameSchema = z
  .string()
  .transform((value) => value.replace(/[\p{Cc}]/gu, "").replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, "Enter your name.")
      .max(100, "Use 100 characters or fewer."),
  );

export const signUpSchema = z.object({
  fullName: fullNameSchema,
  email,
  password: newPassword,
  accountType: z.enum(["renter", "provider"], {
    error: "Choose an account type.",
  }),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(72, "Invalid password."),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const updateNameSchema = z.object({ fullName: fullNameSchema });

/** Reads string fields only; File values and missing keys become "". */
export function formFields<const K extends string>(
  formData: FormData,
  keys: readonly K[],
): Record<K, string> {
  const result = {} as Record<K, string>;
  for (const key of keys) {
    const value = formData.get(key);
    result[key] = typeof value === "string" ? value : "";
  }
  return result;
}

export type FieldErrors = Partial<Record<string, string>>;

export function toFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}
