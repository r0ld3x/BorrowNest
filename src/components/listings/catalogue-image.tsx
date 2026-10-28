"use client";

import { ImageOffIcon } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";

/** Listing photo with a fallback when the file is missing or fails to load. */
export function CatalogueImage({
  src,
  alt,
  sizes,
  priority = false,
  className,
}: {
  src: string | null;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return (
      <div className={cn("flex h-full w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground", className)}>
        <ImageOffIcon aria-hidden="true" className="size-6" />
        <span className="text-xs">{src ? "Photo unavailable" : "No photo"}</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={cn("object-cover", className)}
      onError={() => setFailedSrc(src)}
    />
  );
}
