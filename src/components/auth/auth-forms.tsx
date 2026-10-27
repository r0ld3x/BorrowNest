"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState } from "react";

import { FormMessage, TextField } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import {
  forgotPasswordAction,
  loginAction,
  resetPasswordAction,
  signUpAction,
  updateNameAction,
  type FormState,
} from "@/lib/auth/actions";

const INITIAL: FormState = { status: "idle" };

function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" size="lg" className="h-10 w-full" disabled={pending} aria-disabled={pending}>
      {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

export function LoginForm({ next }: { next: string | null }) {
  const [state, action, pending] = useActionState(loginAction, INITIAL);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <TextField
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <TextField
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.password}
      />
      <SubmitButton pending={pending}>{pending ? "Logging in" : "Log in"}</SubmitButton>
    </form>
  );
}

const ACCOUNT_TYPES = [
  { value: "renter", label: "Renter", description: "I want to rent items." },
  { value: "provider", label: "Provider", description: "I want to list items for rent." },
] as const;

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, INITIAL);

  if (state.status === "success") {
    return <FormMessage status="success" message={state.message} />;
  }

  const selectedType = state.values?.accountType || "renter";
  const typeError = state.fieldErrors?.accountType;

  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />
      <TextField
        name="fullName"
        label="Full name"
        autoComplete="name"
        maxLength={100}
        required
        defaultValue={state.values?.fullName}
        error={state.fieldErrors?.fullName}
      />
      <TextField
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <TextField
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        minLength={8}
        maxLength={72}
        required
        hint="At least 8 characters."
        error={state.fieldErrors?.password}
      />
      <fieldset className="grid gap-2" aria-describedby={typeError ? "account-type-error" : undefined}>
        <legend className="mb-1.5 text-sm font-medium">Account type</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ACCOUNT_TYPES.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-input p-3 transition-colors duration-150 has-checked:border-primary has-checked:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name="accountType"
                value={option.value}
                defaultChecked={selectedType === option.value}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
        {typeError ? (
          <p id="account-type-error" className="text-sm text-destructive">
            {typeError}
          </p>
        ) : null}
      </fieldset>
      <SubmitButton pending={pending}>{pending ? "Creating account" : "Create account"}</SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, INITIAL);

  if (state.status === "success") {
    return <FormMessage status="success" message={state.message} />;
  }

  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />
      <TextField
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <SubmitButton pending={pending}>{pending ? "Sending link" : "Send reset link"}</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(resetPasswordAction, INITIAL);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />
      <TextField
        name="password"
        type="password"
        label="New password"
        autoComplete="new-password"
        minLength={8}
        maxLength={72}
        required
        hint="At least 8 characters."
        error={state.fieldErrors?.password}
      />
      <TextField
        name="confirmPassword"
        type="password"
        label="Confirm new password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.confirmPassword}
      />
      <SubmitButton pending={pending}>{pending ? "Updating password" : "Update password"}</SubmitButton>
    </form>
  );
}

export function UpdateNameForm({ fullName }: { fullName: string }) {
  const [state, action, pending] = useActionState(updateNameAction, INITIAL);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />
      <TextField
        name="fullName"
        label="Full name"
        autoComplete="name"
        maxLength={100}
        required
        defaultValue={state.values?.fullName ?? fullName}
        error={state.fieldErrors?.fullName}
      />
      <div>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
          {pending ? "Saving" : "Save name"}
        </Button>
      </div>
    </form>
  );
}
