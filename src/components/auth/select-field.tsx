"use client";

import { useLayoutEffect, useRef } from "react";

import { CONTROL_CLASS, describedBy, FieldFooter } from "@/components/auth/field-parts";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SelectFieldProps extends Omit<React.ComponentProps<"select">, "id" | "name"> {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  error?: string;
}

/**
 * Labelled select. React only applies `defaultValue` to a select on mount,
 * so after a form action the browser's form reset would snap it back to the
 * first choice. Keeping each option's `defaultSelected` in sync with the
 * latest `defaultValue` makes the reset restore what was submitted.
 */
export function SelectField({ name, label, options, placeholder, error, className, defaultValue, ...props }: SelectFieldProps) {
  const id = `field-${name}`;
  const ref = useRef<HTMLSelectElement>(null);

  useLayoutEffect(() => {
    const select = ref.current;
    if (!select || defaultValue === undefined) return;
    const wanted = String(defaultValue);
    for (const option of Array.from(select.options)) option.defaultSelected = option.value === wanted;
    select.value = wanted;
  }, [defaultValue]);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        ref={ref}
        id={id}
        name={name}
        defaultValue={defaultValue}
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
