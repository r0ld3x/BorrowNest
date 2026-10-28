"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ImagePlusIcon,
  Loader2Icon,
  RotateCcwIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { FormMessage } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import {
  removeListingPhotoAction,
  reorderListingPhotosAction,
  uploadListingPhotoAction,
} from "@/lib/listings/actions";
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_PRODUCT_IMAGES } from "@/lib/listings/options";
import { cn } from "@/lib/utils";

export interface ManagedPhoto {
  id: string;
  url: string;
  caption: string | null;
}

interface PendingPhoto {
  key: string;
  file: File;
  previewUrl: string;
  caption: string;
  status: "ready" | "uploading" | "failed";
  error?: string;
}

/**
 * Client-side checks are only a convenience; the server decodes every photo
 * and the database enforces ownership, signatures, and the 5-photo limit.
 */
function quickCheck(file: File): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) return "Use a JPEG, PNG, or WebP photo.";
  if (file.size > MAX_IMAGE_BYTES) return "Photos must be 5 MB or smaller.";
  return null;
}

export function PhotoManager({
  productId,
  photos,
  readOnly = false,
}: {
  productId: string;
  photos: ManagedPhoto[];
  readOnly?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [message, setMessage] = useState<{ status: "error" | "success"; text: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isChanging, startChange] = useTransition();

  // Release preview object URLs when items leave the list or on unmount.
  const previewsRef = useRef<PendingPhoto[]>([]);
  useEffect(() => {
    previewsRef.current = pending;
  }, [pending]);
  useEffect(() => () => previewsRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  const slotsLeft = MAX_PRODUCT_IMAGES - photos.length - pending.filter((p) => p.status !== "failed").length;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setMessage(null);
    const next: PendingPhoto[] = [];
    let skipped = 0;
    for (const file of Array.from(list)) {
      if (next.length >= slotsLeft) {
        skipped += 1;
        continue;
      }
      const error = quickCheck(file);
      next.push({
        key: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        caption: "",
        status: error ? "failed" : "ready",
        error: error ?? undefined,
      });
    }
    setPending((current) => [...current, ...next]);
    if (skipped > 0) setMessage({ status: "error", text: `A listing can have up to ${MAX_PRODUCT_IMAGES} photos.` });
    if (inputRef.current) inputRef.current.value = "";
  }

  function discard(key: string) {
    setPending((current) => {
      const item = current.find((p) => p.key === key);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return current.filter((p) => p.key !== key);
    });
  }

  async function uploadOne(item: PendingPhoto): Promise<boolean> {
    setPending((current) => current.map((p) => (p.key === item.key ? { ...p, status: "uploading", error: undefined } : p)));
    const formData = new FormData();
    formData.set("productId", productId);
    formData.set("caption", item.caption);
    formData.set("photo", item.file);
    let result: { ok: boolean; message?: string };
    try {
      result = await uploadListingPhotoAction(formData);
    } catch {
      result = { ok: false, message: "The upload was interrupted. Check your connection and retry." };
    }
    if (result.ok) {
      discard(item.key);
      return true;
    }
    setPending((current) =>
      current.map((p) => (p.key === item.key ? { ...p, status: "failed", error: result.message } : p)),
    );
    return false;
  }

  async function uploadAll() {
    setIsUploading(true);
    setMessage(null);
    // Sequential: keeps order predictable and the limit easy to reason about.
    let failures = 0;
    for (const item of pending.filter((p) => p.status === "ready")) {
      if (!(await uploadOne(item))) failures += 1;
    }
    setIsUploading(false);
    setMessage(
      failures
        ? { status: "error", text: "Some photos were not uploaded. Your listing is saved; retry them below." }
        : { status: "success", text: "Photos uploaded." },
    );
  }

  function reorder(nextIds: string[]) {
    setMessage(null);
    startChange(async () => {
      const result = await reorderListingPhotosAction(productId, nextIds);
      if (!result.ok) setMessage({ status: "error", text: result.message ?? "Could not reorder photos." });
    });
  }

  function move(index: number, delta: number) {
    const ids = photos.map((p) => p.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder(ids);
  }

  function makeCover(index: number) {
    const ids = photos.map((p) => p.id);
    const [chosen] = ids.splice(index, 1);
    reorder([chosen!, ...ids]);
  }

  function remove(photoId: string) {
    setMessage(null);
    startChange(async () => {
      const result = await removeListingPhotoAction(photoId);
      if (!result.ok) setMessage({ status: "error", text: result.message ?? "Could not remove the photo." });
    });
  }

  const busy = isUploading || isChanging;
  const readyCount = pending.filter((p) => p.status === "ready").length;

  return (
    <div className="grid gap-4" aria-busy={busy}>
      {message ? <FormMessage status={message.status} message={message.text} /> : null}

      {photos.length === 0 && pending.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No photos yet. Add at least one to submit for review. The first photo is the cover.
        </p>
      ) : null}

      {photos.length > 0 ? (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Listing photos in display order">
          {photos.map((photo, index) => (
            <li key={photo.id} className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="relative aspect-4/3 bg-muted">
                <Image
                  src={photo.url}
                  alt={photo.caption ? `Photo ${index + 1}: ${photo.caption}` : `Listing photo ${index + 1}`}
                  fill
                  sizes="(min-width: 640px) 200px, 45vw"
                  className="object-cover"
                />
                {index === 0 ? (
                  <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium">
                    <StarIcon aria-hidden="true" className="size-3 fill-current text-primary" />
                    Cover
                  </span>
                ) : null}
              </div>
              {photo.caption ? <p className="truncate px-2 pt-2 text-xs text-muted-foreground">{photo.caption}</p> : null}
              {!readOnly ? (
                <div className="flex items-center gap-1 p-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move photo ${index + 1} earlier`}
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowLeftIcon aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move photo ${index + 1} later`}
                    disabled={busy || index === photos.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowRightIcon aria-hidden="true" />
                  </Button>
                  {index > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Make photo ${index + 1} the cover`}
                      disabled={busy}
                      onClick={() => makeCover(index)}
                    >
                      <StarIcon aria-hidden="true" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto text-destructive"
                    aria-label={`Remove photo ${index + 1}`}
                    disabled={busy}
                    onClick={() => remove(photo.id)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {pending.length > 0 ? (
        <ul className="grid gap-3" aria-label="Photos waiting to upload">
          {pending.map((item) => (
            <li key={item.key} className="flex gap-3 rounded-lg border border-border bg-card p-2">
              {/* Local preview of the user's own file; never uploaded from here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.previewUrl} alt="Preview of the selected photo" className="size-20 shrink-0 rounded-md object-cover" />
              <div className="grid min-w-0 flex-1 gap-1.5">
                <p className="truncate text-sm font-medium">{item.file.name}</p>
                {item.status === "failed" ? (
                  <p role="alert" className="text-sm text-destructive">
                    {item.error}
                  </p>
                ) : (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Caption (optional)
                    <input
                      type="text"
                      maxLength={200}
                      value={item.caption}
                      disabled={item.status === "uploading"}
                      onChange={(event) =>
                        setPending((current) =>
                          current.map((p) => (p.key === item.key ? { ...p, caption: event.target.value } : p)),
                        )
                      }
                      className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                  </label>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end justify-between gap-1">
                {item.status === "uploading" ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status">
                    <Loader2Icon aria-hidden="true" className="size-3.5 animate-spin" />
                    Uploading
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Discard ${item.file.name}`}
                    disabled={isUploading}
                    onClick={() => discard(item.key)}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                )}
                {item.status === "failed" && !quickCheck(item.file) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isUploading || slotsLeft <= 0}
                    onClick={async () => {
                      setIsUploading(true);
                      await uploadOne(item);
                      setIsUploading(false);
                    }}
                  >
                    <RotateCcwIcon aria-hidden="true" data-icon="inline-start" />
                    Retry
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            multiple
            className="sr-only"
            disabled={busy || slotsLeft <= 0}
            onChange={(event) => addFiles(event.target.files)}
          />
          <label
            htmlFor={inputId}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              (busy || slotsLeft <= 0) && "pointer-events-none opacity-50",
            )}
          >
            <ImagePlusIcon aria-hidden="true" className="size-4" />
            Choose photos
          </label>
          {readyCount > 0 ? (
            <Button type="button" className="h-9" disabled={isUploading} onClick={uploadAll}>
              {isUploading ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
              {isUploading ? "Uploading" : `Upload ${readyCount} ${readyCount === 1 ? "photo" : "photos"}`}
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            JPEG, PNG or WebP · up to 5 MB each · {Math.max(0, MAX_PRODUCT_IMAGES - photos.length)} of {MAX_PRODUCT_IMAGES} slots left
          </p>
        </div>
      ) : null}
    </div>
  );
}
