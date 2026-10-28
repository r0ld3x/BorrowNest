import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONTROL_CLASS, describedBy, FieldFooter } from "@/components/auth/field-parts";
import { cn } from "@/lib/utils";

interface TextFieldProps extends Omit<React.ComponentProps<"input">, "id" | "name"> {
  name: string;
  label: string;
  error?: string;
  hint?: string;
}

/** Labelled input with an associated, announced error message. */
export function TextField({ name, label, error, hint, className, ...props }: TextFieldProps) {
  const id = `field-${name}`;
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn("h-10", className)}
        {...props}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextAreaFieldProps extends Omit<React.ComponentProps<"textarea">, "id" | "name"> {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  /** Needed when the same field name appears more than once on a page. */
  fieldId?: string;
}

export function TextAreaField({ name, label, error, hint, fieldId, className, ...props }: TextAreaFieldProps) {
  const id = fieldId ?? `field-${name}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(CONTROL_CLASS, "min-h-24 py-2", className)}
        {...props}
      />
      <FieldFooter id={id} hint={hint} error={error} />
    </div>
  );
}

// Client component: it keeps the submitted choice across React's form reset.
export { SelectField } from "@/components/auth/select-field";

export function FormMessage({
  status,
  message,
}: {
  status: "idle" | "error" | "success";
  message?: string;
}) {
  if (!message || status === "idle") return null;
  const isError = status === "error";
  const Icon = isError ? AlertCircleIcon : CheckCircle2Icon;
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
        isError
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-primary/30 bg-accent text-accent-foreground",
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}
