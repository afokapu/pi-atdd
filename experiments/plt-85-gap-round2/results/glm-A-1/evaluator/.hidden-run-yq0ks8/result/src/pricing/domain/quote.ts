import { discountCents } from "./discount.ts";

export type Line = { sku: string; unitPriceCents: number; quantity: number };
export type Quote = { region: string; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number };
/** A quote that includes loyalty points applied to the discounted amount. */
export type QuoteWithPoints = Quote & { pointsCents: number };

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

/**
 * Price a cart including loyalty points: points reduce the amount after the
 * discount and before tax, never below zero (excess points are not applied).
 * 100 points = 1 EUR, so one point is one cent.
 */
export function quoteWithPoints(lines: Line[], region: string, taxRate: number, points: number, discountCode?: string): QuoteWithPoints {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const pointsCents = Math.max(0, Math.min(points, subtotalCents - discount));
  const taxable = subtotalCents - discount - pointsCents;
  const taxCents = taxOn(taxable, taxRate);
  return { region, subtotalCents, discountCents: discount, pointsCents, taxCents, totalCents: taxable + taxCents };
}
