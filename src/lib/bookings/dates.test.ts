import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addDays,
  checkDates,
  gwaliorTimestamp,
  gwaliorToday,
  isValidDate,
  overlapsRanges,
  quote,
  rentalDays,
  toRanges,
} from "./dates.ts";

describe("gwaliorToday", () => {
  it("switches day exactly at Gwalior midnight (18:30 UTC)", () => {
    assert.equal(gwaliorToday(new Date("2026-10-28T18:29:59Z")), "2026-10-28");
    assert.equal(gwaliorToday(new Date("2026-10-28T18:30:00Z")), "2026-10-29");
  });

  it("uses Gwalior time even when UTC is still the previous day", () => {
    // 00:15 IST on the 29th is 18:45 UTC on the 28th.
    assert.equal(gwaliorToday(new Date("2026-10-28T18:45:00Z")), "2026-10-29");
  });
});

describe("checkDates", () => {
  const today = "2026-10-28";
  const base = { pickupTime: "10:00", returnTime: "18:00", today };

  it("yesterday and today are too soon; tomorrow is the earliest start", () => {
    assert.equal(checkDates({ ...base, start: "2026-10-27", end: "2026-10-27" }), "start_too_soon");
    assert.equal(checkDates({ ...base, start: "2026-10-28", end: "2026-10-28" }), "start_too_soon");
    assert.equal(checkDates({ ...base, start: "2026-10-29", end: "2026-10-29" }), null);
  });

  it("allows a one-day rental but requires return after pickup on that day", () => {
    assert.equal(checkDates({ ...base, start: "2026-10-29", end: "2026-10-29" }), null);
    assert.equal(checkDates({ ...base, start: "2026-10-29", end: "2026-10-29", returnTime: "10:00" }), "return_before_pickup");
    assert.equal(checkDates({ ...base, start: "2026-10-29", end: "2026-10-29", returnTime: "09:00" }), "return_before_pickup");
  });

  it("rejects an end date before the start", () => {
    assert.equal(checkDates({ ...base, start: "2026-11-05", end: "2026-11-04" }), "end_before_start");
  });

  it("allows exactly 180 days and rejects 181", () => {
    assert.equal(checkDates({ ...base, start: "2026-10-29", end: addDays("2026-10-29", 179) }), null);
    assert.equal(checkDates({ ...base, start: "2026-10-29", end: addDays("2026-10-29", 180) }), "rental_too_long");
  });

  it("rejects impossible dates and times", () => {
    for (const start of ["2026-02-30", "2027-02-29", "2026-13-01", "29-10-2026", ""]) {
      assert.equal(checkDates({ ...base, start, end: start }), "invalid", start);
    }
    assert.equal(checkDates({ ...base, start: "2026-10-29", end: "2026-10-30", pickupTime: "24:00" }), "invalid");
    assert.equal(checkDates({ ...base, start: "2026-10-29", end: "2026-10-30", pickupTime: "9:00" }), "invalid");
  });

  it("rejects starts more than a year ahead", () => {
    assert.equal(checkDates({ ...base, start: addDays(today, 366), end: addDays(today, 366) }), "start_too_far");
  });
});

describe("day counting and leap years", () => {
  it("counts inclusively across a leap day", () => {
    assert.equal(isValidDate("2028-02-29"), true);
    assert.equal(rentalDays("2028-02-28", "2028-03-01"), 3);
    assert.equal(rentalDays("2027-02-28", "2027-03-01"), 2);
    assert.equal(rentalDays("2026-10-29", "2026-10-29"), 1);
  });
});

describe("quote", () => {
  it("is exact to the paisa", () => {
    assert.deepEqual(quote(55.55, 1200.5, 3), { days: 3, rent: 166.65, deposit: 1200.5, total: 1367.15 });
    // 0.1 + 0.2 style drift would show up here with float maths.
    assert.deepEqual(quote(0.1, 0.2, 3), { days: 3, rent: 0.3, deposit: 0.2, total: 0.5 });
    assert.equal(quote(49999.99, 0, 180).rent, 8999998.2);
  });
});

describe("timestamps and blocked ranges", () => {
  it("builds Gwalior timestamps with the fixed +05:30 offset", () => {
    assert.equal(gwaliorTimestamp("2026-10-29", "00:30"), "2026-10-29T00:30:00+05:30");
    assert.equal(new Date(gwaliorTimestamp("2026-10-29", "00:30")).toISOString(), "2026-10-28T19:00:00.000Z");
  });

  it("collapses booked dates into ranges and detects overlap inclusively", () => {
    const ranges = toRanges(["2026-11-03", "2026-11-01", "2026-11-02", "2026-11-10"]);
    assert.deepEqual(ranges, [
      { start: "2026-11-01", end: "2026-11-03" },
      { start: "2026-11-10", end: "2026-11-10" },
    ]);
    assert.equal(overlapsRanges("2026-11-03", "2026-11-05", ranges), true); // shares an endpoint
    assert.equal(overlapsRanges("2026-11-04", "2026-11-09", ranges), false);
  });
});
