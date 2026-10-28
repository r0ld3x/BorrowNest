import type { DisputeDecision, DisputeStatus, IssueCategory, PossessionOutcome } from "@/types/database";

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  handover: "Handover or meeting",
  payment: "Rent or deposit payment",
  condition: "Item condition",
  return: "Item return",
  refund: "Deposit refund",
  other: "Something else",
};

export const STATUS_LABELS: Record<DisputeStatus, string> = {
  open: "Open",
  in_review: "In review",
  needs_info: "Information requested",
  resolved: "Admin resolved",
};

export const DECISION_LABELS: Record<DisputeDecision, string> = {
  no_action: "No change needed",
  renter_favoured: "Decided for the renter",
  provider_favoured: "Decided for the provider",
  shared: "Shared responsibility",
  admin_closure: "Booking closed by support",
};

export const POSSESSION_LABELS: Record<PossessionOutcome, string> = {
  not_applicable: "Not applicable",
  with_renter: "Still with the renter",
  returned_to_provider: "Back with the provider",
  lost: "Lost",
  damaged: "Damaged",
};

export const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as IssueCategory[]).map((value) => ({ value, label: CATEGORY_LABELS[value] }));
