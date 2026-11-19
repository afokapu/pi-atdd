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

/** A quote with loyalty points applied. `pointsAppliedCents` is what the points took off (1 point = 1 cent). */
export type PointsQuote = Quote & { pointsAppliedCents: number };

/** Price a cart: subtotal, then discount, then tax on the discounted amount. */
export function quote(lines: Line[], region: string, taxRate: number, discountCode?: string): Quote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const taxCents = taxOn(subtotalCents - discount, taxRate);
  return { region, subtotalCents, discountCents: discount, taxCents, totalCents: subtotalCents - discount + taxCents };
}

/**
 * Price a cart with points: subtotal, then discount, then points, then tax. Points never
 * take the amount below zero, and points beyond the discounted amount are not applied.
 */
export function quoteWithPoints(lines: Line[], region: string, taxRate: number, points: number, discountCode?: string): PointsQuote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const pointsAppliedCents = Math.min(points, subtotalCents - discount);
  const taxableCents = subtotalCents - discount - pointsAppliedCents;
  const taxCents = taxOn(taxableCents, taxRate);
  return { region, subtotalCents, discountCents: discount, pointsAppliedCents, taxCents, totalCents: taxableCents + taxCents };
}
