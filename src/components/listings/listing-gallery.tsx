"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { CatalogueImage } from "@/components/listings/catalogue-image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PublicListingImage } from "@/types/listing";

export function ListingGallery({ title, images }: { title: string; images: PublicListingImage[] }) {
  const [index, setIndex] = useState(0);
  const count = images.length;
  const current = images[index];
  const alt = (i: number) =>
    images[i]?.caption ? `${title}: ${images[i]!.caption}` : `${title}, photo ${i + 1} of ${count}`;

  if (count === 0) {
    return (
      <div className="relative aspect-4/3 overflow-hidden rounded-xl border border-border">
        <CatalogueImage src={null} alt="" sizes="100vw" />
      </div>
    );
  }

  const go = (next: number) => setIndex((next + count) % count);

  return (
    <div
      role="region"
      aria-roledescription="gallery"
      aria-label={`Photos of ${title}`}
      className="grid gap-3"
      onKeyDown={(event) => {
        if (count < 2) return;
        if (event.key === "ArrowRight") {
          event.preventDefault();
          go(index + 1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          go(index - 1);
        }
      }}
    >
      <div className="relative aspect-4/3 overflow-hidden rounded-xl border border-border bg-muted">
        <CatalogueImage
          key={current!.id}
          src={current!.url}
          alt={alt(index)}
          priority={index === 0}
          sizes="(min-width: 1024px) 640px, 100vw"
        />
        {count > 1 ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Previous photo"
              className="absolute top-1/2 left-2 size-9 -translate-y-1/2 bg-background/90"
              onClick={() => go(index - 1)}
            >
              <ChevronLeftIcon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Next photo"
              className="absolute top-1/2 right-2 size-9 -translate-y-1/2 bg-background/90"
              onClick={() => go(index + 1)}
            >
              <ChevronRightIcon aria-hidden="true" />
            </Button>
            <p aria-live="polite" className="absolute right-2 bottom-2 rounded-full bg-background/90 px-2.5 py-0.5 text-xs font-medium">
              {index + 1} / {count}
            </p>
          </>
        ) : null}
      </div>
      {current?.caption ? <p className="text-sm text-muted-foreground wrap-break-word">{current.caption}</p> : null}
      {count > 1 ? (
        <ul className="grid grid-cols-5 gap-2" aria-label="Choose a photo">
          {images.map((image, i) => (
            <li key={image.id}>
              <button
                type="button"
                aria-label={`Show photo ${i + 1} of ${count}`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => setIndex(i)}
                className={cn(
                  "relative block aspect-4/3 w-full overflow-hidden rounded-lg border-2 transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  i === index ? "border-primary" : "border-transparent hover:border-border",
                )}
              >
                <CatalogueImage src={image.url} alt="" sizes="120px" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
