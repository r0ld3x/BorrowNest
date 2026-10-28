import { ArrowLeftIcon, LockIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminEditForm } from "@/components/admin/admin-edit-form";
import { FormMessage } from "@/components/auth/form-parts";
import { AuditList } from "@/components/admin/audit-list";
import { ModerationPanel } from "@/components/admin/moderation-panel";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ListingStatusBadge } from "@/components/listings/provider/listing-status-badge";
import { getListingForReview, listAuditForAdmin } from "@/lib/admin/queries";
import { ROLE_LABELS } from "@/lib/auth/redirects";
import { requireRole } from "@/lib/auth/session";
import { labelFor, LISTING_STATUS_LABELS, PRODUCT_CATEGORIES, PRODUCT_CONDITIONS } from "@/lib/listings/options";
import { formatInr } from "@/lib/utils";
import { uuidSchema } from "@/lib/validation/listing";

export const metadata: Metadata = { title: "Review listing · Admin" };

const decisionTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

// Fixed confirmation texts keyed by allowlisted codes; the query value is never echoed.
const NOTICES = {
  approved: "Approved. The listing is now public.",
  rejected: "Rejected. The provider can see your reason, edit the listing and resubmit.",
  corrected: "Listing corrected. The change and your reason are in the activity log.",
} as const;

export default async function AdminListingReviewPage({ params, searchParams }: PageProps<"/admin/listings/[id]">) {
  const profile = await requireRole(["admin"]);
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const noticeMessage = typeof notice === "string" && notice in NOTICES ? NOTICES[notice as keyof typeof NOTICES] : null;
  const productId = uuidSchema.safeParse(id);
  if (!productId.success) notFound();

  const [review, audit] = await Promise.all([getListingForReview(productId.data), listAuditForAdmin(productId.data, 1, 20)]);
  if (!review) notFound();

  const { product, pickup, provider, images } = review;
  const version = product.updated_at;

  return (
    <DashboardShell profile={profile} title="Review listing">
      <Link href="/admin/listings" className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        All listings
      </Link>

      {noticeMessage ? (
        <div className="mb-6">
          <FormMessage status="success" message={noticeMessage} />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="grid gap-6">
          <section aria-labelledby="public-heading" className="rounded-xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 id="public-heading" className="text-xl font-semibold wrap-break-word">
                {product.title}
              </h2>
              <ListingStatusBadge status={product.listing_status} />
            </div>
            {images.length > 0 ? (
              <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Listing photos, cover first">
                {images.map((image, index) => (
                  <li key={image.id} className="relative aspect-4/3 overflow-hidden rounded-lg border border-border bg-muted">
                    <Image
                      src={image.url}
                      alt={image.caption ? `Photo ${index + 1}: ${image.caption}` : `Listing photo ${index + 1}`}
                      fill
                      sizes="(min-width: 1024px) 220px, 45vw"
                      className="object-cover"
                    />
                    {index === 0 ? <span className="absolute top-2 left-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium">Cover</span> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No photos attached.</p>
            )}
            <dl className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[9rem_1fr]">
              <dt className="text-muted-foreground">Category</dt>
              <dd>{labelFor(PRODUCT_CATEGORIES, product.category)}</dd>
              <dt className="text-muted-foreground">Condition</dt>
              <dd>{labelFor(PRODUCT_CONDITIONS, product.condition)}</dd>
              <dt className="text-muted-foreground">Daily rate</dt>
              <dd>{formatInr(product.price_per_day)}</dd>
              <dt className="text-muted-foreground">Refundable deposit</dt>
              <dd>{formatInr(product.deposit)}</dd>
              <dt className="text-muted-foreground">Public location</dt>
              <dd className="wrap-break-word">
                {product.area}, {product.city}
                {product.landmark ? ` · ${product.landmark}` : ""}
              </dd>
              <dt className="text-muted-foreground">Description</dt>
              <dd className="wrap-break-word whitespace-pre-line">{product.description || "—"}</dd>
            </dl>
            {product.moderation_reason ? (
              <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm wrap-break-word">
                Last rejection reason: {product.moderation_reason}
              </p>
            ) : null}
          </section>

          <section aria-labelledby="pickup-heading" className="rounded-xl border border-border bg-card p-6">
            <h2 id="pickup-heading" className="flex items-center gap-2 font-semibold">
              <LockIcon aria-hidden="true" className="size-4" />
              Private pickup details
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">Visible only to the provider and admins. Never shown publicly.</p>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
              <dt className="text-muted-foreground">Address</dt>
              <dd className="wrap-break-word whitespace-pre-line">{pickup?.exact_address ?? "Missing"}</dd>
              <dt className="text-muted-foreground">Instructions</dt>
              <dd className="wrap-break-word whitespace-pre-line">{pickup?.pickup_instructions || "—"}</dd>
            </dl>
          </section>

          <section aria-labelledby="correct-heading" className="rounded-xl border border-border bg-card p-6">
            <h2 id="correct-heading" className="font-semibold">
              Correct listing content
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted-foreground">
              For fixing typos, categories or unsafe wording. The correction and your reason are recorded.
            </p>
            {product.listing_status === "archived" ? (
              <p className="text-sm text-muted-foreground">Archived listings can’t be changed.</p>
            ) : (
              <AdminEditForm
                key={version}
                productId={product.id}
                version={version}
                initialValues={{
                  title: product.title,
                  description: product.description,
                  category: product.category,
                  condition: product.condition,
                  area: product.area,
                  landmark: product.landmark,
                }}
              />
            )}
          </section>
        </div>

        <div className="grid gap-6 lg:sticky lg:top-24">
          <section aria-labelledby="decision-heading" className="grid gap-3 rounded-xl border border-border bg-card p-6">
            <h2 id="decision-heading" className="font-semibold">
              Decision
            </h2>
            {product.listing_status === "pending_review" ? (
              <ModerationPanel key={version} productId={product.id} version={version} />
            ) : (
              <div className="grid gap-1 text-sm">
                <p>
                  Current status: <span className="font-medium">{LISTING_STATUS_LABELS[product.listing_status]}</span>
                </p>
                {product.moderated_at ? (
                  <p className="text-muted-foreground">
                    Last decision recorded {decisionTime.format(new Date(product.moderated_at))}.
                  </p>
                ) : null}
                <p className="text-muted-foreground">Only listings waiting for review can be approved or rejected.</p>
              </div>
            )}
          </section>

          <section aria-labelledby="provider-heading" className="grid gap-2 rounded-xl border border-border bg-card p-6 text-sm">
            <h2 id="provider-heading" className="font-semibold">
              Provider
            </h2>
            {provider ? (
              <>
                <p className="wrap-break-word">{provider.full_name}</p>
                <p className="text-muted-foreground">
                  {ROLE_LABELS[provider.role]} ·{" "}
                  <span className={provider.account_status === "active" ? "" : "font-medium text-destructive"}>
                    {provider.account_status === "active" ? "Active" : "Suspended"}
                  </span>
                </p>
                <Link href={{ pathname: "/admin/users", query: { q: provider.full_name } }} className="font-medium text-primary underline-offset-4 hover:underline">
                  Manage account
                </Link>
              </>
            ) : (
              <p className="text-muted-foreground">Provider profile unavailable.</p>
            )}
          </section>

          <section aria-labelledby="history-heading" className="rounded-xl border border-border bg-card p-6">
            <h2 id="history-heading" className="font-semibold">
              History
            </h2>
            {audit ? <AuditList entries={audit.rows} showTargetLinks={false} /> : <p className="text-sm text-destructive">History could not be loaded.</p>}
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}
