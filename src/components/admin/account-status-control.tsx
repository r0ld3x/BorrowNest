"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useState } from "react";

import { FormMessage, TextAreaField } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { setAccountStatusAction } from "@/lib/admin/actions";
import type { FormState } from "@/lib/auth/actions";
import type { AccountStatus, UserRole } from "@/types/database";

const INITIAL: FormState = { status: "idle" };

export function AccountStatusControl({
  profileId,
  name,
  role,
  status,
  isSelf,
  search,
}: {
  profileId: string;
  name: string;
  role: UserRole;
  status: AccountStatus;
  isSelf: boolean;
  /** Current list search, so the page returns to the same results. */
  search: string;
}) {
  const [state, action, pending] = useActionState(setAccountStatusAction.bind(null, profileId), INITIAL);
  const [open, setOpen] = useState(false);

  if (isSelf) return <span className="text-xs text-muted-foreground">This is you</span>;
  if (state.status === "success") return <FormMessage status="success" message={state.message} />;

  const operation = status === "active" ? "suspend" : "restore";
  const consequence =
    operation === "suspend"
      ? `${name} loses access to protected pages and actions on their next request${
          role === "provider" ? ", and their listings leave the public catalogue immediately" : ""
        }. Records are kept, and anything in progress will need admin support. Sessions already open are not signed out, but the database refuses their protected requests.`
      : `${name} regains normal access${role === "provider" ? ". Listings that were published before the suspension become public again" : ""}.`;

  if (!open) {
    return (
      <Button type="button" variant={operation === "suspend" ? "outline" : "default"} size="sm" className="h-8" onClick={() => setOpen(true)}>
        {operation === "suspend" ? "Suspend…" : "Restore…"}
      </Button>
    );
  }

  return (
    <form action={action} className="grid w-full max-w-md gap-3 rounded-lg border border-border bg-muted/40 p-3">
      <FormMessage status={state.status} message={state.message} />
      <p className="text-sm font-semibold">
        {operation === "suspend" ? `Suspend ${name}?` : `Restore ${name}?`}
      </p>
      <p className="text-sm text-muted-foreground">{consequence}</p>
      <input type="hidden" name="operation" value={operation} />
      <input type="hidden" name="q" value={search} />
      <TextAreaField
        name="reason"
        fieldId={`reason-${profileId}`}
        label="Reason (required, recorded in the activity log)"
        rows={2}
        maxLength={500}
        defaultValue={state.values?.reason}
        error={state.fieldErrors?.reason}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant={operation === "suspend" ? "destructive" : "default"} className="h-8" disabled={pending}>
          {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
          {operation === "suspend" ? "Confirm suspension" : "Confirm restore"}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
