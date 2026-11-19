import { discountCents } from "./discount.ts";

export type Line = { sku: string; unitPriceCents: number; quantity: number };
export type Quote = { region: string; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number };

export function subtotal(lines: Line[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
}

/** Tax on a taxable amount, rounded to the nearest cent. `rate` is fractional (0.19 = 19%). */
export function taxOn(taxableCents: number, rate: number): number {
  return Math.round(taxableCents * rate);
}

/** Price a cart: subtotal, then discount, then tax on the discounted amount. */
export function quote(lines: Line[], region: string, taxRate: number, discountCode?: string): Quote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const taxCents = taxOn(subtotalCents - discount, taxRate);
  return { region, subtotalCents, discountCents: discount, taxCents, totalCents: subtotalCents - discount + taxCents };
}

/** Quote of a cart part-paid with loyalty points (points applied, in cents). */
export type PointsQuote = Quote & { pointsCents: number };

/**
 * Price a cart with loyalty points applied. Adjustment order: subtotal,
 * then discount, then points on the discounted amount, then tax on what
 * remains. All amounts are integer cents; points never push the payable
 * amount below zero (surplus points are not applied), and `taxOn` performs
 * the single rounding step.
 */
export function quoteWithPoints(lines: Line[], region: string, taxRate: number, discountCode: string | undefined, pointsCents: number): PointsQuote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  // Guard the floor here as well as at the ledger: points can never make the
  // amount negative, so surplus points are silently not applied.
  const applied = Math.max(0, Math.min(pointsCents, subtotalCents - discount));
  const taxCents = taxOn(subtotalCents - discount - applied, taxRate);
  return { region, subtotalCents, discountCents: discount, pointsCents: applied,
    taxCents, totalCents: subtotalCents - discount - applied + taxCents };
}
