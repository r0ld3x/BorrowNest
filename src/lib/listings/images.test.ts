import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import sharp from "sharp";

import { processProductPhoto, signPhotoAttachment } from "./images.ts";

const solid = (format: "jpeg" | "png" | "webp", width = 640, height = 480) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 90 } } })
    .toFormat(format)
    .toBuffer();

const asFile = (bytes: Buffer | string, name: string, type: string) =>
  new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, { type });

describe("processProductPhoto", () => {
  for (const format of ["jpeg", "png", "webp"] as const) {
    it(`accepts a real ${format} and re-encodes it to WebP`, async () => {
      const result = await processProductPhoto(asFile(await solid(format), `item.${format}`, `image/${format}`));
      assert.equal(result.ok, true);
      if (result.ok) assert.equal((await sharp(result.data).metadata()).format, "webp");
    });
  }

  it("rejects HTML disguised as a PNG (MIME and extension spoofing)", async () => {
    const html = "<html><script>alert(1)</script></html>";
    assert.deepEqual(await processProductPhoto(asFile(html, "photo.png", "image/png")), {
      ok: false,
      reason: "unsupported_type",
    });
  });

  it("rejects SVG even when labelled as an image", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>';
    const result = await processProductPhoto(asFile(svg, "photo.webp", "image/webp"));
    assert.equal(result.ok, false);
  });

  it("rejects a PNG whose bytes claim to be JPEG", async () => {
    const png = await solid("png");
    const forged = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), png]);
    const result = await processProductPhoto(asFile(forged, "photo.jpg", "image/jpeg"));
    assert.equal(result.ok, false);
  });

  it("rejects truncated or corrupt image data", async () => {
    const jpeg = await solid("jpeg");
    const result = await processProductPhoto(asFile(jpeg.subarray(0, 200), "photo.jpg", "image/jpeg"));
    assert.equal(result.ok, false);
  });

  it("rejects files over 5 MB", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
    assert.deepEqual(await processProductPhoto(asFile(big, "big.jpg", "image/jpeg")), { ok: false, reason: "too_large" });
  });

  it("rejects images that are too small or too large in pixels", async () => {
    assert.deepEqual(await processProductPhoto(asFile(await solid("png", 120, 120), "tiny.png", "image/png")), {
      ok: false,
      reason: "too_small",
    });
    assert.deepEqual(await processProductPhoto(asFile(await solid("png", 9000, 400), "wide.png", "image/png")), {
      ok: false,
      reason: "too_big_dimensions",
    });
  });

  it("rejects animated images", async () => {
    // 3-frame animated WebP (this sharp build cannot write animations).
    const animated = await readFile(new URL("./__fixtures__/animated.webp", import.meta.url));
    assert.ok(((await sharp(animated).metadata()).pages ?? 1) > 1, "fixture should be animated");
    assert.deepEqual(await processProductPhoto(asFile(animated, "anim.webp", "image/webp")), {
      ok: false,
      reason: "animated",
    });
  });

  it("strips EXIF metadata, including GPS location", async () => {
    const withGps = await sharp(await solid("jpeg"))
      .withExif({ IFD0: { Artist: "Provider", ImageDescription: "home" }, GPS: { GPSLatitudeRef: "N", GPSLatitude: "26/1 13/1 0/1" } } as never)
      .jpeg()
      .toBuffer();
    assert.ok((await sharp(withGps).metadata()).exif, "fixture should carry EXIF");
    const result = await processProductPhoto(asFile(withGps, "gps.jpg", "image/jpeg"));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal((await sharp(result.data).metadata()).exif, undefined);
  });
});

describe("signPhotoAttachment", () => {
  it("returns null when no key is configured", () => {
    const saved = process.env.IMAGE_ATTESTATION_SECRET;
    delete process.env.IMAGE_ATTESTATION_SECRET;
    assert.equal(signPhotoAttachment("a", "b", "c"), null);
    process.env.IMAGE_ATTESTATION_SECRET = "short";
    assert.equal(signPhotoAttachment("a", "b", "c"), null);
    if (saved === undefined) delete process.env.IMAGE_ATTESTATION_SECRET;
    else process.env.IMAGE_ATTESTATION_SECRET = saved;
  });

  it("binds the signature to provider, product, and path", () => {
    const saved = process.env.IMAGE_ATTESTATION_SECRET;
    process.env.IMAGE_ATTESTATION_SECRET = "k".repeat(64);
    const base = signPhotoAttachment("p1", "x1", "p1/x1/a.webp");
    assert.match(base ?? "", /^[0-9a-f]{64}$/);
    assert.notEqual(base, signPhotoAttachment("p2", "x1", "p1/x1/a.webp"));
    assert.notEqual(base, signPhotoAttachment("p1", "x2", "p1/x1/a.webp"));
    assert.notEqual(base, signPhotoAttachment("p1", "x1", "p1/x1/b.webp"));
    if (saved === undefined) delete process.env.IMAGE_ATTESTATION_SECRET;
    else process.env.IMAGE_ATTESTATION_SECRET = saved;
  });
});
