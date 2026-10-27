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
