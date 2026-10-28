import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LISTING_CATEGORIES, parseCategoryParam } from "./constants.ts";

describe("parseCategoryParam", () => {
  it("returns null when the parameter is absent", () => {
    assert.equal(parseCategoryParam(undefined), null);
  });

  it("accepts every allowlisted slug", () => {
    for (const { slug } of LISTING_CATEGORIES) {
      assert.equal(parseCategoryParam(slug), slug);
    }
  });

  it("uses the database category vocabulary", () => {
    assert.deepEqual(
      LISTING_CATEGORIES.map((c) => c.slug),
      ["furniture", "appliances", "bicycles", "study_essentials", "kitchen", "other"],
    );
  });

  it("rejects values outside the allowlist", () => {
    for (const value of [
      "study",
      "household",
      "",
      "Furniture",
      " furniture",
      "<script>alert(1)</script>",
      "javascript:alert(1)",
      "../admin",
      "constructor",
      "__proto__",
    ]) {
      assert.equal(parseCategoryParam(value), "invalid", value);
    }
  });

  it("rejects repeated parameters", () => {
    assert.equal(parseCategoryParam(["furniture", "bicycles"]), "invalid");
  });
});
