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

/** Quote of an order paid partly with loyalty points. */
export type PointsQuote = Quote & { pointsApplied: number; pointsCents: number };

/** Price a cart: subtotal, then discount, then tax on the discounted amount. */
export function quote(lines: Line[], region: string, taxRate: number, discountCode?: string): Quote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const taxCents = taxOn(subtotalCents - discount, taxRate);
  return { region, subtotalCents, discountCents: discount, taxCents, totalCents: subtotalCents - discount + taxCents };
}

/** Amount points may pay for: after discount, before tax. */
export function pointsPayableCents(q: Quote): number {
  return q.subtotalCents - q.discountCents;
}

/**
 * Apply a points payment (in cents) to a quote: points reduce the discounted
 * amount before tax, never below zero. Tax is recomputed on the remainder.
 */
export function withPoints(q: Quote, taxRate: number, pointsApplied: number, pointsCents: number): PointsQuote {
  const applied = Math.min(Math.max(0, pointsCents), pointsPayableCents(q));
  const taxable = pointsPayableCents(q) - applied;
  const taxCents = taxOn(taxable, taxRate);
  return { region: q.region, subtotalCents: q.subtotalCents, discountCents: q.discountCents,
    pointsApplied, pointsCents: applied, taxCents, totalCents: taxable + taxCents };
}
