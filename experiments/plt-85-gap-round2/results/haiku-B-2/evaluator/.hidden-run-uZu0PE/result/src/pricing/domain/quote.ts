import { discountCents } from "./discount.ts";

export type Line = { sku: string; unitPriceCents: number; quantity: number };
export type Quote = { region: string; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number };
/** A quote in which loyalty points were applied between discount and tax. */
export type PricedQuote = Quote & { pointsAppliedCents: number };

export function subtotal(lines: Line[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
}

/** Tax on a taxable amount, rounded to the nearest cent. `rate` is fractional (0.19 = 19%). */
export function taxOn(taxableCents: number, rate: number): number {
  return Math.round(taxableCents * rate);
}

/**
 * Price a cart with points: subtotal, then discount, then points, then tax on what remains.
 * Points are capped at the discounted amount so the taxable amount never goes below zero;
 * the caller decides how many points are actually available.
 */
export function quoteWithPoints(lines: Line[], region: string, taxRate: number, discountCode: string | undefined, pointsCents: number): PricedQuote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const afterDiscount = subtotalCents - discount;
  const pointsAppliedCents = Math.min(pointsCents, afterDiscount);
  const taxableCents = afterDiscount - pointsAppliedCents;
  const taxCents = taxOn(taxableCents, taxRate);
  return { region, subtotalCents, discountCents: discount, pointsAppliedCents, taxCents, totalCents: taxableCents + taxCents };
}

/** Price a cart: subtotal, then discount, then tax on the discounted amount. */
export function quote(lines: Line[], region: string, taxRate: number, discountCode?: string): Quote {
  const { pointsAppliedCents: _noPoints, ...priced } = quoteWithPoints(lines, region, taxRate, discountCode, 0);
  return priced;
}
