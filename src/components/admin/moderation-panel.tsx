"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useState } from "react";

import { FormMessage, TextAreaField } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { moderateListingAction } from "@/lib/admin/actions";
import type { FormState } from "@/lib/auth/actions";

const INITIAL: FormState = { status: "idle" };

const CONSEQUENCES = {
  approve: "The listing becomes visible to everyone in the public catalogue.",
  reject: "The listing stays private. The provider sees your reason and can edit and resubmit.",
} as const;

export function ModerationPanel({ productId, version }: { productId: string; version: string }) {
  const [state, action, pending] = useActionState(moderateListingAction.bind(null, productId, version), INITIAL);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");

  if (state.status === "success") return <FormMessage status="success" message={state.message} />;

  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />
      {decision === null ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="h-10" onClick={() => setDecision("approve")}>
            Approve…
          </Button>
          <Button type="button" variant="outline" className="h-10" onClick={() => setDecision("reject")}>
            Reject…
          </Button>
        </div>
      ) : (
        <div
          role="group"
          aria-labelledby="moderation-confirm-title"
          className="grid gap-3 rounded-lg border border-border bg-muted/40 p-4"
        >
          <p id="moderation-confirm-title" className="text-sm font-semibold">
            {decision === "approve" ? "Approve and publish this listing?" : "Reject this listing?"}
          </p>
          <p className="text-sm text-muted-foreground">{CONSEQUENCES[decision]}</p>
          <input type="hidden" name="decision" value={decision} />
          <TextAreaField
            name="reason"
            fieldId="moderation-reason"
            label={decision === "reject" ? "Reason for the provider (required)" : "Note for the activity log (optional)"}
            rows={3}
            maxLength={500}
            required={decision === "reject"}
            hint={decision === "reject" ? "At least 10 characters. Be specific about what to fix." : undefined}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={state.fieldErrors?.reason}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant={decision === "approve" ? "default" : "destructive"}
              className="h-10"
              disabled={pending}
            >
              {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
              {decision === "approve" ? "Confirm approval" : "Confirm rejection"}
            </Button>
            <Button type="button" variant="ghost" className="h-10" disabled={pending} onClick={() => setDecision(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
