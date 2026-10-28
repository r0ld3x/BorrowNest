import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filtersToQuery, parseCatalogueFilters } from "./params.ts";

describe("parseCatalogueFilters", () => {
  it("defaults to everything, newest first, page 1", () => {
    assert.deepEqual(parseCatalogueFilters({}), {
      q: "", category: null, area: "", min: null, max: null, sort: "newest", page: 1, ignored: false,
    });
  });

  it("keeps valid values", () => {
    const f = parseCatalogueFilters({ q: " study  table ", category: "study_essentials", area: "City Centre", min: "20", max: "99.50", sort: "price_asc", page: "3" });
    assert.equal(f.q, "study table");
    assert.equal(f.category, "study_essentials");
    assert.equal(f.area, "City Centre");
    assert.equal(f.min, 20);
    assert.equal(f.max, 99.5);
    assert.equal(f.sort, "price_asc");
    assert.equal(f.page, 3);
    assert.equal(f.ignored, false);
  });

  it("drops unsupported sorts and categories, and says so", () => {
    for (const sort of ["price", "created_at desc; drop table products", "random()"]) {
      const f = parseCatalogueFilters({ sort });
      assert.equal(f.sort, "newest", sort);
      assert.equal(f.ignored, true, sort);
    }
    const c = parseCatalogueFilters({ category: "<script>" });
    assert.equal(c.category, null);
    assert.equal(c.ignored, true);
  });

  it("bounds page numbers", () => {
    assert.equal(parseCatalogueFilters({ page: "999999999" }).page, 1);
    assert.equal(parseCatalogueFilters({ page: "9999" }).page, 200);
    assert.equal(parseCatalogueFilters({ page: "-2" }).page, 1);
    assert.equal(parseCatalogueFilters({ page: "1e9" }).page, 1);
  });

  it("rejects malformed or out-of-range prices and swaps a reversed range", () => {
    for (const min of ["-5", "1e3", "abc", "10.555", "60000", "Infinity"]) {
      const f = parseCatalogueFilters({ min });
      assert.equal(f.min, null, min);
      assert.equal(f.ignored, true, min);
    }
    const swapped = parseCatalogueFilters({ min: "100", max: "20" });
    assert.equal(swapped.min, 20);
    assert.equal(swapped.max, 100);
  });

  it("treats search text as bounded plain text", () => {
    const f = parseCatalogueFilters({ q: "%' OR 1=1 --\u0000<img src=x>".padEnd(300, "x") });
    assert.equal(f.q.length, 100);
    assert.ok(!f.q.includes("\u0000"));
    assert.ok(f.q.startsWith("%' OR 1=1 -- <img src=x>"));
  });

  it("ignores repeated parameters instead of guessing", () => {
    const f = parseCatalogueFilters({ q: ["a", "b"], sort: ["price_asc", "price_desc"] });
    assert.equal(f.q, "");
    assert.equal(f.sort, "newest");
    assert.equal(f.ignored, true);
  });
});

describe("filtersToQuery", () => {
  it("emits only non-default, validated values", () => {
    assert.deepEqual(filtersToQuery(parseCatalogueFilters({})), {});
    assert.deepEqual(filtersToQuery(parseCatalogueFilters({ category: "bicycles", sort: "newest", page: "2", min: "0" })), {
      category: "bicycles",
      min: "0",
      page: "2",
    });
  });
});
