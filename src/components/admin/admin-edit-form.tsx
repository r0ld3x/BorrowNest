"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState } from "react";

import { FormMessage, SelectField, TextAreaField, TextField } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { adminEditListingAction } from "@/lib/admin/actions";
import type { FormState } from "@/lib/auth/actions";
import { PRODUCT_CATEGORIES, PRODUCT_CONDITIONS } from "@/lib/listings/options";

const INITIAL: FormState = { status: "idle" };

export interface AdminEditValues {
  title: string;
  description: string;
  category: string;
  condition: string;
  area: string;
  landmark: string;
}

/** Corrects public text only. Price, deposit, owner and address are not editable here. */
export function AdminEditForm({
  productId,
  version,
  initialValues,
}: {
  productId: string;
  version: string;
  initialValues: AdminEditValues;
}) {
  const [state, action, pending] = useActionState(adminEditListingAction.bind(null, productId, version), INITIAL);
  const values = { ...initialValues, reason: "", ...(state.values ?? {}) } as AdminEditValues & { reason: string };
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />
      <fieldset disabled={pending} className="grid gap-4">
        <TextField name="title" label="Title" maxLength={120} defaultValue={values.title} error={errors.title} />
        <TextAreaField name="description" label="Description" rows={4} maxLength={2000} defaultValue={values.description} error={errors.description} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField name="category" label="Category" options={PRODUCT_CATEGORIES} defaultValue={values.category} error={errors.category} />
          <SelectField name="condition" label="Condition" options={PRODUCT_CONDITIONS} defaultValue={values.condition} error={errors.condition} />
          <TextField name="area" label="Area" maxLength={80} defaultValue={values.area} error={errors.area} />
          <TextField name="landmark" label="Landmark" maxLength={120} defaultValue={values.landmark} error={errors.landmark} />
        </div>
        <TextAreaField
          name="reason"
          fieldId="correction-reason"
          label="Reason for the correction (required)"
          rows={2}
          maxLength={500}
          hint="Recorded in the activity log. At least 10 characters."
          defaultValue={values.reason}
          error={errors.reason}
        />
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Saving keeps the listing’s current status. Price, deposit and pickup address can only be changed by the provider.
      </p>
      <div>
        <Button type="submit" variant="outline" className="h-10" disabled={pending}>
          {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
          Save correction
        </Button>
      </div>
    </form>
  );
}
