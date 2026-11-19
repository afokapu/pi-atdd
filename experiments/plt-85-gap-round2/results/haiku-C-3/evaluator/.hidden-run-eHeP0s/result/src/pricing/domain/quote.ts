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

/** A quote in which loyalty points pay part of the total. `pointsCents` is the amount actually applied. */
export type PointsQuote = Quote & { pointsCents: number };

/**
 * Price a cart paid partly with points. Adjustment order: subtotal, discount, points, then tax
 * on what remains. Points never take the amount below zero; requested points beyond the
 * remaining amount are not applied (and so must not be consumed by the caller).
 */
export function quoteWithPoints(lines: Line[], region: string, taxRate: number, discountCode: string | undefined, requestedPointsCents: number): PointsQuote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const afterDiscount = subtotalCents - discount;
  const pointsCents = Math.min(requestedPointsCents, afterDiscount);
  const taxCents = taxOn(afterDiscount - pointsCents, taxRate);
  return { region, subtotalCents, discountCents: discount, pointsCents, taxCents, totalCents: afterDiscount - pointsCents + taxCents };
}
