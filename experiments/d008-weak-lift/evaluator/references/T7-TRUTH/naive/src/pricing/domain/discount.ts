/** Pricing domain: supported cart discounts, in cents. */
export class UnknownDiscountCodeError extends Error {}

export function discountedSubtotal(subtotalCents: number, code?: string): number {
  if (code === undefined) return subtotalCents;
  if (code === "SAVE10") return subtotalCents - Math.round(subtotalCents * 0.1);
  if (code === "FLAT5") return subtotalCents - 500;
  return subtotalCents;
}
