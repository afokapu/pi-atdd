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

/** Quote for an order partly paid with loyalty points (100 points = 1 EUR, so 1 point = 1 cent). */
export type PointsQuote = Quote & { pointsCents: number };

/**
 * Price a cart where points pay part of the amount: points are applied after
 * discount and before tax, never pushing the pre-tax amount below zero (the
 * applied points are capped by the discounted subtotal), and excess points
 * are not consumed. Tax is computed on whatever the customer still pays.
 */
export function quoteWithPoints(lines: Line[], region: string, taxRate: number, discountCode: string | undefined, pointsCents: number): PointsQuote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const applied = Math.max(0, Math.min(pointsCents, subtotalCents - discount));
  const taxCents = taxOn(subtotalCents - discount - applied, taxRate);
  return { region, subtotalCents, discountCents: discount, pointsCents: applied,
    taxCents, totalCents: subtotalCents - discount - applied + taxCents };
}
