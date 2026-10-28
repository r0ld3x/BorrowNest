import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const CONTROL_CLASS =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30";

function describedBy(id: string, hint?: string, error?: string) {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

function FieldFooter({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  return (
    <>
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
    </>
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

interface SelectFieldProps extends Omit<React.ComponentProps<"select">, "id" | "name"> {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  error?: string;
}

export function SelectField({ name, label, options, placeholder, error, className, ...props }: SelectFieldProps) {
  const id = `field-${name}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, undefined, error)}
        className={cn(CONTROL_CLASS, "h-10 bg-background", className)}
        {...props}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldFooter id={id} error={error} />
    </div>
  );
}

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
