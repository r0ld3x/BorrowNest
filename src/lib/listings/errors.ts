// Maps database 'BN:<code>' errors to fixed, user-facing text. Raw database
// messages are never shown to users.

const FIELD_ERRORS: Record<string, [field: string, message: string]> = {
  invalid_title: ["title", "Title must be 3 to 120 characters."],
  invalid_description: ["description", "Description must be 2,000 characters or fewer."],
  invalid_category: ["category", "Choose a category."],
  invalid_condition: ["condition", "Choose a condition."],
  invalid_price: ["pricePerDay", "Enter a valid daily rate."],
  invalid_deposit: ["deposit", "Enter a valid deposit."],
  invalid_area: ["area", "Area must be 2 to 80 characters."],
  invalid_landmark: ["landmark", "Landmark must be 120 characters or fewer."],
  invalid_address: ["exactAddress", "Pickup address must be 5 to 500 characters."],
  invalid_pickup_instructions: ["pickupInstructions", "Pickup instructions must be 1,000 characters or fewer."],
};

const MESSAGES: Record<string, string> = {
  not_active_provider: "Only active provider accounts can manage listings.",
  listing_not_found: "This listing could not be found.",
  listing_archived: "Archived listings can’t be changed.",
  invalid_transition: "That action isn’t available for this listing right now.",
  description_too_short: "Add a description of at least 20 characters before submitting.",
  missing_pickup_details: "Add a pickup address before submitting.",
  missing_images: "Add at least one photo before submitting.",
  image_limit: "A listing can have up to 5 photos.",
  image_not_found: "That photo could not be found.",
  invalid_image_order: "The photo order changed. Refresh and try again.",
  invalid_caption: "Captions must be 200 characters or fewer.",
  attestation_not_configured: "Photo uploads are not set up on this server yet.",
  invalid_image_path: "That photo could not be saved. Please try again.",
  invalid_image_signature: "That photo could not be saved. Please try again.",
  image_not_uploaded: "That photo could not be saved. Please try again.",
  image_already_used: "That photo could not be saved. Please try again.",
  // Stage 4 admin operations
  not_active_admin: "Only active admin accounts can do this.",
  invalid_decision: "Choose approve or reject.",
  stale_listing: "This listing changed since you opened it. Reload the page and review it again.",
  listing_incomplete: "This listing can’t be published: it needs valid details, a pickup address, and at least one photo.",
  provider_not_active: "The provider’s account is not active, so this listing can’t be published.",
  reason_required: "Enter a reason of at least 10 characters.",
  reason_too_long: "Keep the reason to 500 characters or fewer.",
  account_not_found: "That account could not be found.",
  cannot_suspend_self: "You can’t suspend your own account.",
  last_active_admin: "You can’t suspend the last active admin.",
};

export const GENERIC_LISTING_ERROR = "Something went wrong. Please try again in a moment.";

export function listingErrorCode(error: { message?: string } | null | undefined): string | null {
  return error?.message?.match(/BN:([a-z_]+)/)?.[1] ?? null;
}

export function describeListingError(error: { message?: string; code?: string } | null | undefined): {
  message: string;
  field?: { name: string; message: string };
} {
  const code = listingErrorCode(error);
  if (code && code in FIELD_ERRORS) {
    const [name, message] = FIELD_ERRORS[code]!;
    return { message: "Check the highlighted fields.", field: { name, message } };
  }
  if (code && code in MESSAGES) return { message: MESSAGES[code]! };
  return { message: GENERIC_LISTING_ERROR };
}
