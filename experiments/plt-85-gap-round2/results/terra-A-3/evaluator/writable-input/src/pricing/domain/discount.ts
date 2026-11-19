/**
 * Pricing domain: discount codes applied to a cart subtotal.
 * Known codes: SAVE10 (10% off, rounded to the nearest cent) and FLAT5 (500 cents off).
 */
export class UnknownDiscountCodeError extends Error {}

/** Discount in cents for a subtotal; never more than the subtotal. No code = no discount. */
export function discountCents(subtotalCents: number, code?: string): number {
  if (code === undefined) return 0;
  if (code === "SAVE10") return Math.min(subtotalCents, Math.round(subtotalCents * 0.1));
  if (code === "FLAT5") return Math.min(subtotalCents, 500);
  throw new UnknownDiscountCodeError("unknown discount code " + code);
}

export function discountedSubtotal(subtotalCents: number, code?: string): number {
  return subtotalCents - discountCents(subtotalCents, code);
}
