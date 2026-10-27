// Browser-safe helpers only. Server-only modules belong in separate files
// guarded with `import "server-only"` when they are introduced.
export { cn } from "cn";

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatInr(amount: number): string {
  return inrFormatter.format(amount);
}
