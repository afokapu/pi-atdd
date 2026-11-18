/**
 * Pricing domain: discount codes applied to a cart subtotal.
 * Known codes: SAVE10 (10% off) and FLAT5 (500 cents off).
 */
export class UnknownDiscountCodeError extends Error {}

// TODO(PRC-DISC-001): apply discount codes.
export function discountedSubtotal(subtotalCents: number, code?: string): number {
  return subtotalCents;
}
