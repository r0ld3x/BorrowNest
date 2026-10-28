// Mirrors supabase/migrations. Regenerate with:
//   npx supabase gen types typescript --project-id <ref> --schema public > src/types/database.ts

export type UserRole = "renter" | "provider" | "admin";
export type AccountStatus = "active" | "suspended";
export type ListingStatus =
  | "draft"
  | "pending_review"
  | "published"
  | "paused"
  | "rejected"
  | "archived";
export type BookingStatus = "pending" | "confirmed" | "rejected" | "cancelled" | "completed" | "closed";

export type BookingEventType =
  | "request_created"
  | "request_confirmed"
  | "request_rejected"
  | "request_cancelled"
  | "admin_cancelled"
  | "handover_prepared"
  | "handover_revised"
  | "handover_confirmed"
  | "rental_activated"
  | "issue_reported"
  | "issue_resolved"
  | "return_proposed"
  | "return_accepted"
  | "return_prepared"
  | "return_revised"
  | "return_confirmed"
  | "rental_completed"
  | "dispute_opened"
  | "dispute_status_changed"
  | "dispute_resolved"
  | "admin_closed";

export type RentalPhase = "awaiting_handover" | "active" | "return_requested" | "returned";

export type PaymentMethod = "cash" | "upi" | "bank_transfer";
/** "none" only on a return with nothing to refund. */
export type ExchangeMethod = PaymentMethod | "none";
export type ParticipantRole = "renter" | "provider";
export type IssueCategory = "handover" | "payment" | "condition" | "return" | "refund" | "other";
export type DisputeStatus = "open" | "in_review" | "needs_info" | "resolved";
export type DisputeDecision = "no_action" | "renter_favoured" | "provider_favoured" | "shared" | "admin_closure";
export type PossessionOutcome = "not_applicable" | "with_renter" | "returned_to_provider" | "lost" | "damaged";

type BookingTerms = {
  id: string;
  start_date: string;
  end_date: string;
  pickup_at: string;
  return_at: string;
  rental_days: number;
  price_per_day: number;
  deposit: number;
  rental_amount: number;
  total_due: number;
  note: string;
  status: BookingStatus;
  created_at: string;
};

export type AuditAction =
  | "listing.approve"
  | "listing.reject"
  | "listing.edit"
  | "account.suspend"
  | "account.restore"
  | "booking.cancel"
  | "booking.issue_resolve"
  | "dispute.open_on_behalf"
  | "dispute.status"
  | "dispute.resolve"
  | "booking.admin_close"
  | "listing.inventory_hold"
  | "listing.inventory_release";

type ListingContentArgs = {
  p_title: string;
  p_description: string;
  p_category: string;
  p_condition: string;
  p_price_per_day: string;
  p_deposit: string;
  p_area: string;
  p_landmark: string;
  p_exact_address: string;
  p_pickup_instructions: string;
};

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13.0.5";
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          role: UserRole;
          account_status: AccountStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        // Column privileges allow updating full_name only.
        Update: { full_name?: string };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          provider_id: string;
          title: string;
          description: string;
          category: string;
          condition: string;
          price_per_day: number;
          deposit: number;
          city: string;
          area: string;
          landmark: string;
          listing_status: ListingStatus;
          moderation_reason: string | null;
          moderated_by: string | null;
          moderated_at: string | null;
          inventory_hold: "lost" | "damaged" | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      product_images: {
        Row: {
          id: string;
          product_id: string;
          storage_path: string;
          sort_order: number;
          caption: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_events: {
        Row: {
          id: string;
          booking_id: string;
          actor_id: string | null;
          event_type: BookingEventType;
          previous_status: BookingStatus | null;
          next_status: BookingStatus | null;
          reason: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      booking_pickup_snapshots: {
        Row: { booking_id: string; exact_address: string; pickup_instructions: string; created_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      bookings: {
        Row: BookingTerms & { product_id: string; renter_id: string; provider_id: string; phase: RentalPhase; updated_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Stage 8 handover records (read-only for clients; written by functions).
      booking_exchanges: {
        Row: {
          id: string;
          booking_id: string;
          kind: "handover" | "return";
          revision: number;
          created_by: string;
          rent_amount: number;
          deposit_amount: number;
          payment_method: ExchangeMethod;
          condition_notes: string;
          change_reason: string | null;
          // Return rows only (null on handover rows).
          deduction_amount: number | null;
          deduction_reason: string | null;
          refund_due: number | null;
          scheduled_at: string;
          status: "current" | "superseded";
          superseded_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      return_proposals: {
        Row: {
          id: string;
          booking_id: string;
          version: number;
          proposed_by: string;
          proposer_role: ParticipantRole;
          proposed_at: string;
          note: string | null;
          status: "pending" | "accepted" | "superseded";
          responded_by: string | null;
          responded_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      exchange_confirmations: {
        Row: {
          id: string;
          exchange_id: string;
          participant_id: string;
          participant_role: ParticipantRole;
          acknowledged: string[];
          confirmed_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      exchange_evidence: {
        Row: { id: string; exchange_id: string; storage_path: string; caption: string | null; uploaded_by: string; created_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Stage 10 disputes (Stage 8 issue flags migrated in place). Read-only for clients.
      booking_disputes: {
        Row: {
          id: string;
          booking_id: string;
          opened_by: string;
          opened_by_role: ParticipantRole | "admin";
          on_behalf_of: ParticipantRole | null;
          category: IssueCategory;
          description: string;
          status: DisputeStatus;
          phase_at_open: RentalPhase | null;
          post_completion: boolean;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      dispute_messages: {
        Row: {
          id: string;
          dispute_id: string;
          author_id: string;
          author_role: ParticipantRole | "admin";
          kind: "statement" | "info_request" | "status_note";
          body: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      dispute_evidence: {
        Row: {
          id: string;
          dispute_id: string;
          storage_path: string;
          caption: string | null;
          uploaded_by: string;
          uploader_role: ParticipantRole;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      dispute_resolutions: {
        Row: {
          id: string;
          dispute_id: string;
          admin_id: string;
          decision: DisputeDecision;
          reason: string;
          acknowledged_facts: string | null;
          provider_owes_renter: number;
          renter_owes_provider: number;
          obligation_note: string | null;
          possession_outcome: PossessionOutcome;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      admin_closures: {
        Row: {
          id: string;
          booking_id: string;
          resolution_id: string;
          admin_id: string;
          possession_outcome: "returned_to_provider" | "lost" | "damaged";
          provider_owes_renter_outstanding: number;
          renter_owes_provider_outstanding: number;
          reason: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      product_pickup_details: {
        Row: {
          product_id: string;
          exact_address: string;
          pickup_instructions: string;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      published_products: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          title: string;
          description: string;
          category: string;
          condition: string;
          price_per_day: number;
          deposit: number;
          city: string;
          area: string;
          landmark: string;
          created_at: string;
        }[];
      };
      published_product_images: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          product_id: string;
          storage_path: string;
          sort_order: number;
          caption: string | null;
        }[];
      };
      // Stage 3 provider functions. Amounts are sent as exact decimal strings.
      create_listing_draft: { Args: ListingContentArgs; Returns: string };
      update_listing: { Args: ListingContentArgs & { p_product_id: string }; Returns: ListingStatus };
      submit_listing: { Args: { p_product_id: string }; Returns: ListingStatus };
      pause_listing: { Args: { p_product_id: string }; Returns: ListingStatus };
      resume_listing: { Args: { p_product_id: string }; Returns: ListingStatus };
      archive_listing: { Args: { p_product_id: string }; Returns: ListingStatus };
      attach_product_image: {
        Args: { p_product_id: string; p_storage_path: string; p_caption: string; p_signature: string };
        Returns: string;
      };
      reorder_product_images: { Args: { p_product_id: string; p_image_ids: string[] }; Returns: undefined };
      remove_product_image: { Args: { p_image_id: string }; Returns: string };
      // Stage 6 booking requests.
      create_booking: {
        Args: {
          p_product_id: string;
          p_start_date: string;
          p_end_date: string;
          p_pickup_at: string;
          p_return_at: string;
          p_note: string;
          p_request_key: string;
        };
        Returns: string;
      };
      product_blocked_dates: {
        Args: { p_product_id: string; p_from: string | null; p_to: string | null };
        Returns: { blocked_date: string }[];
      };
      renter_bookings: {
        Args: { p_booking_id: string | null; p_limit: number; p_offset: number };
        Returns: (BookingTerms & {
          product_id: string;
          product_title: string;
          product_area: string;
          product_landmark: string;
          cover_path: string | null;
          listed_by: string | null;
          phase: RentalPhase;
          no_longer_available: boolean;
          decision_reason: string | null;
          total_count: number;
        })[];
      };
      provider_booking_requests: {
        Args: { p_status: BookingStatus | null; p_booking_id: string | null; p_limit: number; p_offset: number };
        Returns: (BookingTerms & {
          product_id: string;
          product_title: string;
          renter_name: string | null;
          no_longer_available: boolean;
          pickup_expired: boolean;
          total_count: number;
        })[];
      };
      // Stage 7 transitions.
      transition_booking: {
        Args: { p_booking_id: string; p_action: "confirm" | "reject" | "cancel"; p_reason: string };
        Returns: BookingStatus;
      };
      admin_cancel_booking: {
        Args: { p_booking_id: string; p_reason: string; p_settlement_note: string };
        Returns: BookingStatus;
      };
      // Stage 8 handover.
      prepare_handover: {
        Args: { p_booking_id: string; p_condition_notes: string; p_payment_method: PaymentMethod };
        Returns: string;
      };
      revise_handover: {
        Args: {
          p_exchange_id: string;
          p_expected_revision: number;
          p_condition_notes: string;
          p_payment_method: PaymentMethod;
          p_reason: string;
        };
        Returns: string;
      };
      confirm_handover: {
        Args: { p_exchange_id: string; p_revision: number; p_acknowledgements: string[] };
        Returns: RentalPhase;
      };
      // Stage 9 return and settlement.
      propose_return: {
        Args: { p_booking_id: string; p_proposed_at: string; p_note: string; p_expected_version: number };
        Returns: string;
      };
      accept_return: { Args: { p_proposal_id: string }; Returns: RentalPhase };
      prepare_return: {
        Args: {
          p_booking_id: string;
          p_condition_notes: string;
          p_deduction: string;
          p_deduction_reason: string;
          p_refund_method: string;
        };
        Returns: string;
      };
      revise_return: {
        Args: {
          p_exchange_id: string;
          p_expected_revision: number;
          p_condition_notes: string;
          p_deduction: string;
          p_deduction_reason: string;
          p_refund_method: string;
          p_reason: string;
        };
        Returns: string;
      };
      confirm_return: {
        Args: { p_exchange_id: string; p_revision: number; p_deduction: string; p_refund: string; p_acknowledgements: string[] };
        Returns: RentalPhase;
      };
      attach_exchange_evidence: {
        Args: { p_exchange_id: string; p_storage_path: string; p_caption: string; p_signature: string };
        Returns: string;
      };
      // Stage 10 disputes.
      open_dispute: { Args: { p_booking_id: string; p_category: IssueCategory; p_description: string }; Returns: string };
      add_dispute_message: { Args: { p_dispute_id: string; p_body: string }; Returns: string };
      attach_dispute_evidence: {
        Args: { p_dispute_id: string; p_storage_path: string; p_caption: string; p_signature: string };
        Returns: string;
      };
      admin_open_dispute_for: {
        Args: { p_booking_id: string; p_on_behalf: ParticipantRole; p_category: IssueCategory; p_description: string };
        Returns: string;
      };
      admin_set_dispute_status: { Args: { p_dispute_id: string; p_status: "in_review" | "needs_info"; p_note: string }; Returns: string };
      admin_resolve_dispute: {
        Args: {
          p_dispute_id: string;
          p_decision: DisputeDecision;
          p_reason: string;
          p_facts: string;
          p_provider_owes_renter: string;
          p_renter_owes_provider: string;
          p_obligation_note: string;
          p_possession: PossessionOutcome;
        };
        Returns: "resolved" | "closed";
      };
      admin_release_inventory_hold: { Args: { p_product_id: string; p_reason: string }; Returns: "released" };
      admin_list_disputes: {
        Args: { p_status: DisputeStatus | "all" | null; p_limit: number; p_offset: number };
        Returns: {
          id: string;
          booking_id: string;
          product_title: string;
          category: IssueCategory;
          status: DisputeStatus;
          opened_by_role: ParticipantRole | "admin";
          on_behalf_of: ParticipantRole | null;
          post_completion: boolean;
          booking_status: BookingStatus;
          booking_phase: RentalPhase;
          message_count: number;
          created_at: string;
          updated_at: string;
          total_count: number;
        }[];
      };
      // Stage 5 public catalogue (explicit safe columns only).
      search_published_products: {
        Args: {
          p_query: string;
          p_category: string | null;
          p_area: string;
          p_min_price: number | null;
          p_max_price: number | null;
          p_sort: string;
          p_limit: number;
          p_offset: number;
        };
        Returns: {
          id: string;
          title: string;
          category: string;
          condition: string;
          price_per_day: number;
          deposit: number;
          area: string;
          landmark: string;
          cover_path: string | null;
          image_count: number;
          listed_by: string | null;
          published_at: string | null;
          total_count: number;
        }[];
      };
      get_published_product: {
        Args: { p_product_id: string };
        Returns: {
          id: string;
          title: string;
          description: string;
          category: string;
          condition: string;
          price_per_day: number;
          deposit: number;
          city: string;
          area: string;
          landmark: string;
          listed_by: string | null;
          published_at: string | null;
        }[];
      };
      get_published_product_images: {
        Args: { p_product_id: string };
        Returns: { id: string; storage_path: string; sort_order: number; caption: string | null }[];
      };
      published_areas: {
        Args: Record<PropertyKey, never>;
        Returns: { area: string; listing_count: number }[];
      };
      // Stage 4 admin functions (each checks for an active admin).
      moderate_listing: {
        Args: { p_product_id: string; p_decision: "approve" | "reject"; p_reason: string; p_expected_updated_at: string };
        Returns: ListingStatus;
      };
      admin_edit_listing: {
        Args: {
          p_product_id: string;
          p_expected_updated_at: string;
          p_title: string;
          p_description: string;
          p_category: string;
          p_condition: string;
          p_area: string;
          p_landmark: string;
          p_reason: string;
        };
        Returns: ListingStatus;
      };
      suspend_account: { Args: { p_profile_id: string; p_reason: string }; Returns: AccountStatus };
      restore_account: { Args: { p_profile_id: string; p_reason: string }; Returns: AccountStatus };
      admin_overview: {
        Args: Record<PropertyKey, never>;
        Returns: {
          pending_review: number;
          published: number;
          rejected: number;
          total_listings: number;
          accounts: number;
          suspended_accounts: number;
          providers: number;
          renters: number;
        }[];
      };
      admin_list_listings: {
        Args: { p_status: ListingStatus | null; p_search: string; p_limit: number; p_offset: number };
        Returns: {
          id: string;
          title: string;
          category: string;
          area: string;
          price_per_day: number;
          deposit: number;
          listing_status: ListingStatus;
          updated_at: string;
          provider_id: string;
          provider_name: string;
          provider_status: AccountStatus;
          image_count: number;
          cover_path: string | null;
          total_count: number;
        }[];
      };
      admin_list_accounts: {
        Args: { p_search: string; p_limit: number; p_offset: number };
        Returns: {
          id: string;
          full_name: string;
          email: string | null;
          role: UserRole;
          account_status: AccountStatus;
          created_at: string;
          listing_count: number;
          total_count: number;
        }[];
      };
      admin_list_audit: {
        Args: { p_target_id: string | null; p_limit: number; p_offset: number };
        Returns: {
          id: string;
          action: AuditAction;
          target_type: "product" | "profile" | "booking";
          target_id: string;
          reason: string | null;
          summary: Record<string, unknown>;
          created_at: string;
          actor_id: string;
          actor_name: string | null;
          total_count: number;
        }[];
      };
    };
    Enums: {
      user_role: UserRole;
      account_status: AccountStatus;
      listing_status: ListingStatus;
      booking_status: BookingStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};
