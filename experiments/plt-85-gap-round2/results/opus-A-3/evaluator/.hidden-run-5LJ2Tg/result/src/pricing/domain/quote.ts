import { discountCents } from "./discount.ts";

export type Line = { sku: string; unitPriceCents: number; quantity: number };
export type Quote = { region: string; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number };
/** Quote of an order partly paid with loyalty points. */
export type QuoteWithPoints = {
  region: string; subtotalCents: number; discountCents: number;
  pointsApplied: number; pointsAppliedCents: number; taxCents: number; totalCents: number;
};

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
 * Price a cart paid partly with points: subtotal, then discount, then points
 * (worth `pointsCents`, capped so the amount never goes below zero), then tax.
 */
export function quoteWithPoints(lines: Line[], region: string, taxRate: number, discountCode: string | undefined,
  points: number, pointsCents: number): QuoteWithPoints {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const afterDiscount = subtotalCents - discount;
  const applied = Math.min(afterDiscount, pointsCents);
  const taxable = afterDiscount - applied;
  const taxCents = taxOn(taxable, taxRate);
  return { region, subtotalCents, discountCents: discount, pointsApplied: points, pointsAppliedCents: applied,
    taxCents, totalCents: taxable + taxCents };
}
