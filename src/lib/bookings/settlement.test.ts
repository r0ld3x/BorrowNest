import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkSettlement, paiseToDecimal, parseRupees } from "./settlement.ts";

describe("parseRupees", () => {
  it("parses whole and decimal rupees exactly", () => {
    assert.equal(parseRupees("0"), 0);
    assert.equal(parseRupees("250"), 25000);
    assert.equal(parseRupees("250.5"), 25050);
    assert.equal(parseRupees(" 0.07 "), 7);
  });
  it("rejects negatives, extra decimals and text", () => {
    for (const bad of ["-1", "1.001", "1e3", "abc", "", "1,000", "0x10"]) assert.equal(parseRupees(bad), null, bad);
  });
});

describe("paiseToDecimal", () => {
  it("formats paise as an exact decimal string", () => {
    assert.equal(paiseToDecimal(0), "0.00");
    assert.equal(paiseToDecimal(7), "0.07");
    assert.equal(paiseToDecimal(250050), "2500.50");
  });
});

describe("checkSettlement", () => {
  const base = { depositPaise: 100000, reason: "", refundMethod: "upi" };
  it("full refund", () => {
    assert.deepEqual(checkSettlement({ ...base, deduction: "0" }), { ok: true, deductionPaise: 0, refundPaise: 100000 });
  });
  it("partial refund needs a reason", () => {
    assert.deepEqual(checkSettlement({ ...base, deduction: "200" }), { ok: false, problem: "deduction_reason_required" });
    assert.deepEqual(checkSettlement({ ...base, deduction: "200", reason: "Cleaning" }), { ok: true, deductionPaise: 20000, refundPaise: 80000 });
  });
  it("zero refund needs no refund method", () => {
    assert.deepEqual(checkSettlement({ ...base, deduction: "1000", reason: "Broken leg", refundMethod: "" }), {
      ok: true,
      deductionPaise: 100000,
      refundPaise: 0,
    });
  });
  it("refuses a deduction above the deposit, and a refund without a method", () => {
    assert.deepEqual(checkSettlement({ ...base, deduction: "1000.01", reason: "Too much" }), { ok: false, problem: "deduction_too_large" });
    assert.deepEqual(checkSettlement({ ...base, deduction: "10", reason: "Small fee", refundMethod: "paypal" }), {
      ok: false,
      problem: "refund_method_required",
    });
  });
});
