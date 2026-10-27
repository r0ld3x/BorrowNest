import type { ListingCategorySlug } from "@/lib/constants";
import type { Listing } from "@/types/listing";

// Sample data for Stage 1 only. These are illustrative items, not real
// providers or real offers. Areas and landmarks are public places only.
export const SAMPLE_LISTINGS: readonly Listing[] = [
  {
    id: "sample-sofa-three-seater",
    title: "Three-seater fabric sofa",
    category: "furniture",
    city: "Gwalior",
    area: "Thatipur",
    landmark: "Near Thatipur Chauraha",
    dailyRate: 120,
    refundableDeposit: 2500,
    coverImage: {
      src: "/images/listings/sofa-three-seater.webp",
      alt: "Illustration of a green three-seater fabric sofa with two cushions",
    },
    featured: true,
  },
  {
    id: "sample-single-bed-mattress",
    title: "Single bed with mattress",
    category: "furniture",
    city: "Gwalior",
    area: "Station Road",
    landmark: "Near Gwalior Railway Station",
    dailyRate: 90,
    refundableDeposit: 2000,
    coverImage: {
      src: "/images/listings/single-bed-mattress.webp",
      alt: "Illustration of a wooden single bed with a mattress, pillow, and green blanket",
    },
    featured: false,
  },
  {
    id: "sample-refrigerator-single-door",
    title: "Single-door refrigerator (190 L)",
    category: "appliances",
    city: "Gwalior",
    area: "Morar",
    landmark: "Near Morar Bus Stand",
    dailyRate: 80,
    refundableDeposit: 3000,
    coverImage: {
      src: "/images/listings/refrigerator-single-door.webp",
      alt: "Illustration of a white single-door refrigerator with a small freezer compartment",
    },
    featured: true,
  },
  {
    id: "sample-washing-machine",
    title: "Semi-automatic washing machine",
    category: "appliances",
    city: "Gwalior",
    area: "DD Nagar",
    landmark: "Near DD Nagar Park",
    dailyRate: 70,
    refundableDeposit: 2500,
    coverImage: {
      src: "/images/listings/washing-machine-semi-automatic.webp",
      alt: "Illustration of a white twin-tub semi-automatic washing machine",
    },
    featured: false,
  },
  {
    id: "sample-bicycle-geared",
    title: "Geared city bicycle",
    category: "bicycles",
    city: "Gwalior",
    area: "Lashkar",
    landmark: "Near Maharaj Bada",
    dailyRate: 60,
    refundableDeposit: 1500,
    coverImage: {
      src: "/images/listings/bicycle-geared.webp",
      alt: "Illustration of a red geared bicycle with a black seat and handlebar",
    },
    featured: true,
  },
  {
    id: "sample-bicycle-single-speed",
    title: "Single-speed bicycle with basket",
    category: "bicycles",
    city: "Gwalior",
    area: "Gola Ka Mandir",
    landmark: "Near Gola Ka Mandir Chauraha",
    dailyRate: 45,
    refundableDeposit: 1000,
    coverImage: {
      src: "/images/listings/bicycle-single-speed.webp",
      alt: "Illustration of a green single-speed bicycle with a front basket",
    },
    featured: false,
  },
  {
    id: "sample-study-table-chair",
    title: "Study table with chair and lamp",
    category: "study",
    city: "Gwalior",
    area: "City Centre",
    landmark: "Near Jiwaji University",
    dailyRate: 55,
    refundableDeposit: 1200,
    coverImage: {
      src: "/images/listings/study-table-chair.webp",
      alt: "Illustration of a wooden study table with a drawer, desk lamp, books, and a chair",
    },
    featured: true,
  },
  {
    id: "sample-bookshelf-desk-lamp",
    title: "Bookshelf and desk lamp set",
    category: "study",
    city: "Gwalior",
    area: "Shinde Ki Chhawani",
    landmark: "Near Shinde Ki Chhawani Chauraha",
    dailyRate: 35,
    refundableDeposit: 800,
    coverImage: {
      src: "/images/listings/bookshelf-desk-lamp.webp",
      alt: "Illustration of a three-shelf wooden bookshelf with books beside a floor lamp",
    },
    featured: false,
  },
  {
    id: "sample-induction-cooktop-set",
    title: "Induction cooktop with cookware",
    category: "kitchen",
    city: "Gwalior",
    area: "Phool Bagh",
    landmark: "Near Phool Bagh",
    dailyRate: 40,
    refundableDeposit: 1000,
    coverImage: {
      src: "/images/listings/induction-cooktop-set.webp",
      alt: "Illustration of an induction cooktop with a steel pot and a frying pan",
    },
    featured: false,
  },
];

export function getFeaturedSampleListings(): readonly Listing[] {
  return SAMPLE_LISTINGS.filter((listing) => listing.featured);
}

export function getSampleListings(
  category: ListingCategorySlug | null,
): readonly Listing[] {
  if (category === null) return SAMPLE_LISTINGS;
  return SAMPLE_LISTINGS.filter((listing) => listing.category === category);
}
