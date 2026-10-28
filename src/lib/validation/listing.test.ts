import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listingSchema, statusOperationSchema, uuidSchema } from "./listing.ts";

const valid = {
  title: "  Study   table with chair ",
  description: "Solid wood table, 4 ft wide.\nComes with a chair.",
  category: "study_essentials",
  condition: "good",
  pricePerDay: "55",
  deposit: "1200.50",
  area: "City Centre",
  landmark: "Near Jiwaji University",
  exactAddress: "Test address, not real",
  pickupInstructions: "",
};

describe("listingSchema", () => {
  it("normalizes valid input", () => {
    const result = listingSchema.parse(valid);
    assert.equal(result.title, "Study table with chair");
    assert.equal(result.description, "Solid wood table, 4 ft wide.\nComes with a chair.");
    assert.equal(result.deposit, "1200.50");
  });

  it("rejects prices with more than two decimals instead of rounding", () => {
    for (const pricePerDay of ["55.555", "0.001", "1e3", "-5", "0", "₹55", "55,00", " ", "50001", "Infinity"]) {
      assert.equal(listingSchema.safeParse({ ...valid, pricePerDay }).success, false, pricePerDay);
    }
    assert.equal(listingSchema.safeParse({ ...valid, pricePerDay: "0.5" }).success, true);
  });

  it("allows a zero deposit but not a negative or oversized one", () => {
    assert.equal(listingSchema.safeParse({ ...valid, deposit: "0" }).success, true);
    assert.equal(listingSchema.safeParse({ ...valid, deposit: "-1" }).success, false);
    assert.equal(listingSchema.safeParse({ ...valid, deposit: "500001" }).success, false);
  });

  it("rejects unexpected enum values", () => {
    for (const category of ["Furniture", "household", "study", "", "admin"]) {
      assert.equal(listingSchema.safeParse({ ...valid, category }).success, false, category);
    }
    assert.equal(listingSchema.safeParse({ ...valid, condition: "excellent" }).success, false);
  });

  it("keeps HTML-looking text as plain text", () => {
    const result = listingSchema.parse({ ...valid, title: "<img src=x onerror=alert(1)>" });
    assert.equal(result.title, "<img src=x onerror=alert(1)>");
  });

  it("enforces length bounds", () => {
    assert.equal(listingSchema.safeParse({ ...valid, title: "ab" }).success, false);
    assert.equal(listingSchema.safeParse({ ...valid, title: "x".repeat(121) }).success, false);
    assert.equal(listingSchema.safeParse({ ...valid, area: "x" }).success, false);
    assert.equal(listingSchema.safeParse({ ...valid, exactAddress: "1234" }).success, false);
    assert.equal(listingSchema.safeParse({ ...valid, description: "x".repeat(2001) }).success, false);
  });
});

describe("ids and operations", () => {
  it("rejects malformed ids", () => {
    for (const id of ["", "1", "../etc/passwd", "00000000-0000-0000-0000-000000000000x", "' or 1=1 --"]) {
      assert.equal(uuidSchema.safeParse(id).success, false, id);
    }
    assert.equal(uuidSchema.safeParse("3f9c1a2e-8b7d-4c6e-9f0a-1b2c3d4e5f60").success, true);
  });

  it("allowlists status operations, with no way to publish or approve", () => {
    for (const op of ["publish", "approve", "published", "SUBMIT", ""]) {
      assert.equal(statusOperationSchema.safeParse(op).success, false, op);
    }
  });
});
