import { SERVICE_CITY, SITE_NAME, SITE_TAGLINE } from "@/lib/constants";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-card">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-[1fr_2fr]">
        <div>
          <p className="font-semibold tracking-tight">{SITE_NAME}</p>
          <p className="mt-1 text-sm text-muted-foreground">{SITE_TAGLINE}</p>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            {SITE_NAME} is a rental marketplace for people living in{" "}
            {SERVICE_CITY} for a while. Renters borrow furniture, appliances,
            bicycles, and other essentials from local providers instead of
            buying them.
          </p>
          <p>
            We currently operate in {SERVICE_CITY}, India only. Every listing is
            reviewed by BorrowNest before it appears, and payments are made
            offline between renter and provider.
          </p>
        </div>
      </div>
    </footer>
  );
}
