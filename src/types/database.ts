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
export type BookingStatus = "pending" | "confirmed" | "rejected" | "cancelled" | "completed";

export type AuditAction =
  | "listing.approve"
  | "listing.reject"
  | "listing.edit"
  | "account.suspend"
  | "account.restore";

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
          target_type: "product" | "profile";
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
