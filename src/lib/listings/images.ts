import "server-only";

import { createHmac } from "node:crypto";
import sharp from "sharp";

import { MAX_IMAGE_BYTES } from "@/lib/listings/options";

const MIN_DIMENSION = 300;
const MAX_DIMENSION = 8000;
const MAX_INPUT_PIXELS = 40_000_000;
const OUTPUT_MAX_EDGE = 2000;

export type PhotoRejection =
  | "missing"
  | "too_large"
  | "unsupported_type"
  | "unreadable"
  | "animated"
  | "too_small"
  | "too_big_dimensions";

export const PHOTO_REJECTION_MESSAGES: Record<PhotoRejection, string> = {
  missing: "Choose a photo to upload.",
  too_large: "Photos must be 5 MB or smaller.",
  unsupported_type: "Use a JPEG, PNG, or WebP photo.",
  unreadable: "That file could not be read as a photo.",
  animated: "Animated images are not supported.",
  too_small: `Photos must be at least ${MIN_DIMENSION} × ${MIN_DIMENSION} pixels.`,
  too_big_dimensions: `Photos must be at most ${MAX_DIMENSION} pixels on each side.`,
};

type SniffedFormat = "jpeg" | "png" | "webp";

/** Identifies the format from the file's actual bytes, never its name or MIME label. */
function sniffFormat(bytes: Buffer): SniffedFormat | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/**
 * Trusted decode step for product photos: checks real bytes, fully decodes
 * with bounded pixel counts, then re-encodes to WebP. Re-encoding drops all
 * metadata, including EXIF GPS coordinates that could reveal a home address.
 */
export async function processProductPhoto(
  file: unknown,
): Promise<{ ok: true; data: Buffer } | { ok: false; reason: PhotoRejection }> {
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, reason: "missing" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };

  const input = Buffer.from(await file.arrayBuffer());
  if (input.length > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };

  const sniffed = sniffFormat(input);
  if (!sniffed) return { ok: false, reason: "unsupported_type" };

  const options = {
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: "error" as const,
  };
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(input, options).metadata();
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  if (metadata.format !== sniffed)
    return { ok: false, reason: "unsupported_type" };
  if ((metadata.pages ?? 1) > 1) return { ok: false, reason: "animated" };
  const { width = 0, height = 0 } = metadata;
  if (width < MIN_DIMENSION || height < MIN_DIMENSION)
    return { ok: false, reason: "too_small" };
  if (width > MAX_DIMENSION || height > MAX_DIMENSION)
    return { ok: false, reason: "too_big_dimensions" };

  try {
    const data = await sharp(input, options)
      .rotate() // apply EXIF orientation before the metadata is dropped
      .resize({
        width: OUTPUT_MAX_EDGE,
        height: OUTPUT_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    if (data.length > MAX_IMAGE_BYTES)
      return { ok: false, reason: "too_large" };
    return { ok: true, data };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** Null when the server has no attestation key configured. */
export function signPhotoAttachment(
  providerId: string,
  productId: string,
  storagePath: string,
): string | null {
  const key = process.env.IMAGE_ATTESTATION_SECRET;
  if (!key || key.length < 32) return null;
  return createHmac("sha256", key)
    .update(`v1:${providerId}:${productId}:${storagePath}`)
    .digest("hex");
}

/** Signature for a handover evidence photo; checked by attach_exchange_evidence. */
export function signEvidenceAttachment(
  userId: string,
  exchangeId: string,
  storagePath: string,
): string | null {
  const key = process.env.IMAGE_ATTESTATION_SECRET;
  if (!key || key.length < 32) return null;
  return createHmac("sha256", key)
    .update(`evidence:v1:${userId}:${exchangeId}:${storagePath}`)
    .digest("hex");
}

/** Signature for a dispute evidence photo; checked by attach_dispute_evidence. */
export function signDisputeAttachment(userId: string, disputeId: string, storagePath: string): string | null {
  const key = process.env.IMAGE_ATTESTATION_SECRET;
  if (!key || key.length < 32) return null;
  return createHmac("sha256", key).update(`dispute:v1:${userId}:${disputeId}:${storagePath}`).digest("hex");
}
