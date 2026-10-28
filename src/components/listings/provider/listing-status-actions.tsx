"use client";

import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { changeListingStatusAction } from "@/lib/listings/actions";
import type { ListingStatus } from "@/types/database";

type Operation = "submit" | "pause" | "resume" | "archive";

// What the provider may request in each state. The database enforces the
// same rules; this only decides which buttons to show.
const AVAILABLE: Record<ListingStatus, Operation[]> = {
  draft: ["submit", "archive"],
  rejected: ["submit", "archive"],
  pending_review: ["archive"],
  published: ["pause", "archive"],
  paused: ["resume", "archive"],
  archived: [],
};

const LABELS: Record<Exclude<Operation, "archive">, string> = {
  submit: "Submit for review",
  pause: "Pause listing",
  resume: "Resume listing",
};

export function ListingStatusActions({ productId, status }: { productId: string; status: ListingStatus }) {
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState<Operation | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [message, setMessage] = useState<{ status: "error" | "success"; text: string } | null>(null);

  const operations = AVAILABLE[status];
  if (operations.length === 0) {
    return <p className="text-sm text-muted-foreground">Archived listings stay in your history and can’t be changed.</p>;
  }

  function run(operation: Operation) {
    setMessage(null);
    setRunning(operation);
    startTransition(async () => {
      const result = await changeListingStatusAction(productId, operation);
      setMessage({ status: result.ok ? "success" : "error", text: result.message ?? "" });
      setRunning(null);
      setConfirmingArchive(false);
    });
  }

  return (
    <div className="grid gap-3">
      {message?.text ? <FormMessage status={message.status} message={message.text} /> : null}
      <div className="flex flex-wrap gap-2">
        {operations
          .filter((op): op is Exclude<Operation, "archive"> => op !== "archive")
          .map((op) => (
            <Button key={op} type="button" className="h-9" disabled={isPending} onClick={() => run(op)}>
              {running === op ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
              {LABELS[op]}
            </Button>
          ))}
        {operations.includes("archive") && !confirmingArchive ? (
          <Button type="button" variant="outline" className="h-9" disabled={isPending} onClick={() => setConfirmingArchive(true)}>
            Archive
          </Button>
        ) : null}
      </div>
      {confirmingArchive ? (
        <div role="alertdialog" aria-labelledby="archive-title" aria-describedby="archive-desc" className="grid gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p id="archive-title" className="text-sm font-semibold">
            Archive this listing?
          </p>
          <p id="archive-desc" className="text-sm text-muted-foreground">
            It will be hidden from renters and can no longer be edited. Its
            history is kept. This cannot be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" className="h-9" disabled={isPending} onClick={() => run("archive")} autoFocus>
              {running === "archive" ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
              Archive listing
            </Button>
            <Button type="button" variant="ghost" className="h-9" disabled={isPending} onClick={() => setConfirmingArchive(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
