import Link from "next/link";

import type { AuditEntry } from "@/lib/admin/queries";
import { LISTING_STATUS_LABELS } from "@/lib/listings/options";

const ACTION_LABELS: Record<AuditEntry["action"], string> = {
  "listing.approve": "Approved listing",
  "listing.reject": "Rejected listing",
  "listing.edit": "Corrected listing",
  "account.suspend": "Suspended account",
  "account.restore": "Restored account",
  "booking.cancel": "Cancelled booking",
  "booking.issue_resolve": "Resolved booking issue",
  "dispute.open_on_behalf": "Opened a dispute on a participant’s behalf",
  "dispute.status": "Updated a dispute’s status",
  "dispute.resolve": "Resolved a dispute",
  "booking.admin_close": "Closed a booking (admin resolution)",
  "listing.inventory_hold": "Held a listing’s inventory",
  "listing.inventory_release": "Released a listing’s inventory hold",
};

const dateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function text(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function statusLabel(value: unknown): string | null {
  const v = text(value);
  if (!v) return null;
  return (LISTING_STATUS_LABELS as Record<string, string>)[v] ?? v;
}

/** Turns the structured summary into plain-text lines (React escapes them). */
function describe(entry: AuditEntry): string[] {
  const s = entry.summary ?? {};
  const lines: string[] = [];
  const title = text(s.title) ?? text(s.name);
  if (title) lines.push(title);
  if (s.from && s.to) lines.push(`${statusLabel(s.from)} → ${statusLabel(s.to)}`);
  if (s.before && typeof s.before === "object" && s.after && typeof s.after === "object") {
    for (const [field, after] of Object.entries(s.after as Record<string, unknown>)) {
      const before = (s.before as Record<string, unknown>)[field];
      lines.push(`${field}: “${text(before) ?? ""}” → “${text(after) ?? ""}”`);
    }
  }
  return lines;
}

export function AuditList({ entries, showTargetLinks = true }: { entries: AuditEntry[]; showTargetLinks?: boolean }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No admin actions recorded yet.</p>;
  }
  return (
    <ol className="divide-y divide-border">
      {entries.map((entry) => (
        <li key={entry.id} className="grid gap-1 py-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              {ACTION_LABELS[entry.action] ?? entry.action}
              <span className="font-normal text-muted-foreground"> by {entry.actor_name ?? "a former admin"}</span>
            </p>
            <time dateTime={entry.created_at} className="text-xs text-muted-foreground">
              {dateTime.format(new Date(entry.created_at))}
            </time>
          </div>
          {describe(entry).map((line, i) => (
            <p key={i} className="wrap-break-word text-muted-foreground">
              {line}
            </p>
          ))}
          {entry.reason ? <p className="wrap-break-word">Reason: {entry.reason}</p> : null}
          {showTargetLinks && entry.target_type === "product" ? (
            <Link
              href={`/admin/listings/${entry.target_id}`}
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Open listing
            </Link>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
