"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState } from "react";

import { FormMessage, SelectField, TextAreaField, TextField } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/actions";
import { createListingAction, updateListingAction } from "@/lib/listings/actions";
import { PRODUCT_CATEGORIES, PRODUCT_CONDITIONS } from "@/lib/listings/options";

export interface ListingFormValues {
  title: string;
  description: string;
  category: string;
  condition: string;
  pricePerDay: string;
  deposit: string;
  area: string;
  landmark: string;
  exactAddress: string;
  pickupInstructions: string;
}

const EMPTY: ListingFormValues = {
  title: "",
  description: "",
  category: "",
  condition: "",
  pricePerDay: "",
  deposit: "0",
  area: "",
  landmark: "",
  exactAddress: "",
  pickupInstructions: "",
};

const INITIAL: FormState = { status: "idle" };

export function ListingForm({
  productId,
  initialValues,
  disabled = false,
}: {
  /** Omitted when creating a new draft. */
  productId?: string;
  initialValues?: ListingFormValues;
  disabled?: boolean;
}) {
  const action = productId ? updateListingAction.bind(null, productId) : createListingAction;
  const [state, formAction, pending] = useActionState(action, INITIAL);

  // After a submit, show what was sent (React resets the form fields).
  const values = { ...EMPTY, ...initialValues, ...(state.values as Partial<ListingFormValues> | undefined) };
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="grid gap-8" noValidate>
      <FormMessage status={state.status} message={state.message} />

      <fieldset disabled={disabled || pending} className="grid gap-5">
        <legend className="mb-1 text-base font-semibold">Item details</legend>
        <TextField name="title" label="Title" maxLength={120} required defaultValue={values.title} error={errors.title} />
        <TextAreaField
          name="description"
          label="Description"
          maxLength={2000}
          rows={5}
          hint="What it is, its size, and anything a renter should know. At least 20 characters to submit."
          defaultValue={values.description}
          error={errors.description}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            name="category"
            label="Category"
            options={PRODUCT_CATEGORIES}
            placeholder="Choose a category"
            required
            defaultValue={values.category}
            error={errors.category}
          />
          <SelectField
            name="condition"
            label="Condition"
            options={PRODUCT_CONDITIONS}
            placeholder="Choose a condition"
            required
            defaultValue={values.condition}
            error={errors.condition}
          />
        </div>
      </fieldset>

      <fieldset disabled={disabled || pending} className="grid gap-5">
        <legend className="mb-1 text-base font-semibold">Price</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            name="pricePerDay"
            label="Daily rate (₹)"
            inputMode="decimal"
            required
            hint="Charged per calendar day."
            defaultValue={values.pricePerDay}
            error={errors.pricePerDay}
          />
          <TextField
            name="deposit"
            label="Refundable deposit (₹)"
            inputMode="decimal"
            required
            hint="Returned when the item comes back as agreed."
            defaultValue={values.deposit}
            error={errors.deposit}
          />
        </div>
      </fieldset>

      <fieldset disabled={disabled || pending} className="grid gap-5">
        <legend className="mb-1 text-base font-semibold">Location in Gwalior</legend>
        <p className="-mt-3 text-sm text-muted-foreground">
          Pickup only for now; delivery may come later. Renters see the area
          and landmark. The exact address stays private until you confirm a
          booking.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            name="area"
            label="Area (public)"
            maxLength={80}
            required
            placeholder="e.g. Thatipur"
            defaultValue={values.area}
            error={errors.area}
          />
          <TextField
            name="landmark"
            label="Nearby landmark (public)"
            maxLength={120}
            placeholder="e.g. Near Thatipur Chauraha"
            defaultValue={values.landmark}
            error={errors.landmark}
          />
        </div>
        <TextAreaField
          name="exactAddress"
          label="Exact pickup address (private)"
          maxLength={500}
          rows={2}
          required
          defaultValue={values.exactAddress}
          error={errors.exactAddress}
        />
        <TextAreaField
          name="pickupInstructions"
          label="Pickup instructions (private)"
          maxLength={1000}
          rows={2}
          hint="For example, which gate to use or the best time to call."
          defaultValue={values.pickupInstructions}
          error={errors.pickupInstructions}
        />
      </fieldset>

      {!disabled ? (
        <div>
          <Button type="submit" size="lg" className="h-10 px-5" disabled={pending}>
            {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
            {productId ? (pending ? "Saving" : "Save changes") : pending ? "Creating draft" : "Create draft"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
