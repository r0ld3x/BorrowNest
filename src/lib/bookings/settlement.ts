// Deposit settlement maths in integer paise. The database repeats every
// check (0 <= deduction <= deposit, refund = deposit - deduction); this is
// for validation messages and the live preview.

const RUPEES = /^\d{1,7}(\.\d{1,2})?$/;

/** "250" or "250.5" → 25050 paise; null for anything else (negatives, 3 decimals, text). */
export function parseRupees(value: string): number | null {
  const v = value.trim();
  if (!RUPEES.test(v)) return null;
  const [whole, fraction = ""] = v.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Exact decimal string for the database, e.g. 25050 → "250.50". */
export function paiseToDecimal(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

export type SettlementProblem = "invalid_deduction" | "deduction_too_large" | "deduction_reason_required" | "refund_method_required";

export function checkSettlement(input: {
  depositPaise: number;
  deduction: string;
  reason: string;
  refundMethod: string;
}): { ok: true; deductionPaise: number; refundPaise: number } | { ok: false; problem: SettlementProblem } {
  const deductionPaise = parseRupees(input.deduction);
  if (deductionPaise === null) return { ok: false, problem: "invalid_deduction" };
  if (deductionPaise > input.depositPaise) return { ok: false, problem: "deduction_too_large" };
  if (deductionPaise > 0 && input.reason.trim().length < 5) return { ok: false, problem: "deduction_reason_required" };
  const refundPaise = input.depositPaise - deductionPaise;
  if (refundPaise > 0 && !["cash", "upi", "bank_transfer"].includes(input.refundMethod)) {
    return { ok: false, problem: "refund_method_required" };
  }
  return { ok: true, deductionPaise, refundPaise };
}
