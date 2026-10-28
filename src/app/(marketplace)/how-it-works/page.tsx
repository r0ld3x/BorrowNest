import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { SERVICE_CITY } from "@/lib/constants";

export const metadata: Metadata = {
  title: "How it works",
  description: `How renters, providers and admins use BorrowNest in ${SERVICE_CITY}, shown with screenshots from the app.`,
};

// Flow images are composed from real screenshots of the app. Each lists its
// steps in text too, so the content doesn't depend on reading the image.
const FLOWS = [
  {
    id: "rental",
    src: "/images/how-it-works/05-rental-and-return-flow.webp",
    title: "A successful rental, start to finish",
    intro: "Every step needs both people. Nothing completes on a timer or because one person clicked.",
    steps: [
      "The renter requests dates. It isn’t a reservation yet.",
      "The provider confirms. The dates are reserved and overlapping requests are blocked.",
      "At pickup the renter ticks that they received the item, agree with its condition and paid the rent and deposit offline.",
      "The provider confirms the same summary, and the rental becomes active.",
      "Either of them proposes a return time at or before the original return; the other accepts.",
      "The provider records the return condition and any agreed deduction from the deposit.",
      "Both confirm the same return summary, with the exact refund.",
      "The booking is completed, with a receipt showing both confirmations.",
    ],
  },
  {
    id: "renter",
    src: "/images/how-it-works/02-renter-journey.webp",
    title: "Renter journey",
    intro: "Find an item, request dates, then confirm the handover and the return together with the provider.",
    steps: [
      "Browse and search approved listings in Gwalior.",
      "Request dates; the price and deposit are calculated for you.",
      "Once confirmed, the exact pickup address appears.",
      "Confirm the handover with three explicit statements. Nothing is pre-ticked.",
      "Agree a return time with the provider.",
      "Get a completion receipt once you both confirm the return.",
    ],
  },
  {
    id: "provider",
    src: "/images/how-it-works/01-provider-journey.webp",
    title: "Provider journey",
    intro: "List an item, get it approved, rent it out and settle the deposit, all recorded in the app.",
    steps: [
      "Create a listing with a daily rate, deposit and public area. The exact address stays private.",
      "Add photos and submit it for review. Photos are re-encoded, removing location data.",
      "A BorrowNest admin approves it, and it goes public.",
      "Confirm a renter’s request to reserve the dates.",
      "Share a handover summary: condition notes and how the renter pays you offline.",
      "When the item comes back, settle the deposit: deposit minus any agreed deduction is the refund.",
    ],
  },
  {
    id: "listing",
    src: "/images/how-it-works/04-listing-approval-flow.webp",
    title: "From draft to bookable listing",
    intro: "Every listing is reviewed before renters can see it.",
    steps: [
      "The provider creates a draft.",
      "They add photos.",
      "They submit it; it waits for review and isn’t public yet.",
      "It appears in the admin review queue.",
      "An admin approves it, and the decision is recorded.",
      "Renters can now find and request it.",
    ],
  },
  {
    id: "admin",
    src: "/images/how-it-works/03-admin-journey.webp",
    title: "Admin moderation and disputes",
    intro: "Admins review listings and resolve disputes. Every decision has a reason and is recorded in the activity log.",
    steps: [
      "Listings waiting for approval appear in a review queue.",
      "The admin approves or rejects with a note.",
      "Approved listings appear in the public catalogue.",
      "Disputes appear in a separate queue; an open dispute pauses the booking’s confirmations.",
      "The admin reads both sides and records a decision, including any money still owed.",
      "Both participants see the outcome marked “Admin resolved”, separate from a mutual completion.",
    ],
  },
] as const;

export default function HowItWorksPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
      <header className="max-w-3xl">
        <p className="text-sm font-medium text-primary">How it works</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Renting in {SERVICE_CITY}, step by step</h1>
        <p className="mt-3 text-muted-foreground">
          These flows use real screenshots from BorrowNest. Payments happen offline between renter and provider; the app records what you
          both agree to and never holds money.
        </p>
      </header>

      <nav aria-label="Flows on this page" className="mt-8 flex flex-wrap gap-2">
        {FLOWS.map((flow) => (
          <a
            key={flow.id}
            href={`#${flow.id}`}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium hover:border-primary/40 hover:bg-accent"
          >
            {flow.title}
          </a>
        ))}
      </nav>

      <div className="mt-10 grid gap-14">
        {FLOWS.map((flow, index) => (
          <section key={flow.id} id={flow.id} aria-labelledby={`${flow.id}-heading`} className="scroll-mt-20">
            <h2 id={`${flow.id}-heading`} className="text-2xl font-semibold tracking-tight">
              {flow.title}
            </h2>
            <p className="mt-1.5 text-muted-foreground">{flow.intro}</p>
            <figure className="mt-5 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <a href={flow.src} target="_blank" rel="noopener" aria-label={`Open the full-size “${flow.title}” image`}>
                <Image
                  src={flow.src}
                  alt={`${flow.title}: ${flow.steps.length} steps shown with app screenshots, listed below.`}
                  width={2400}
                  height={1350}
                  sizes="(min-width: 1152px) 1104px, 100vw"
                  className="h-auto w-full"
                  priority={index === 0}
                />
              </a>
            </figure>
            <ol className="mt-4 grid gap-x-6 gap-y-2 text-sm text-muted-foreground sm:grid-cols-2">
              {flow.steps.map((step, i) => (
                <li key={step} className="flex gap-2">
                  <span className="font-semibold text-foreground tabular-nums">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <div className="mt-14 flex flex-wrap gap-3">
        <Link href="/listings" className={buttonVariants({ className: "h-10 px-5" })}>
          Browse listings
          <ArrowRightIcon aria-hidden="true" />
        </Link>
        <Link href="/signup" className={buttonVariants({ variant: "outline", className: "h-10 px-5" })}>
          Create an account
        </Link>
      </div>
    </div>
  );
}
