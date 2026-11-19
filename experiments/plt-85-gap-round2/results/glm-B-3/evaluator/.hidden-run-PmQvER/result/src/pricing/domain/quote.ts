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

/** A quote that already has loyalty points applied: `pointsCents` is what they knocked off. */
export type RedeemedQuote = Quote & { pointsCents: number };

/** Price a cart: subtotal, then discount, then tax on the discounted amount. */
export function quote(lines: Line[], region: string, taxRate: number, discountCode?: string): Quote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const taxCents = taxOn(subtotalCents - discount, taxRate);
  return { region, subtotalCents, discountCents: discount, taxCents, totalCents: subtotalCents - discount + taxCents };
}

/**
 * Price a cart paid partly with loyalty points. Points reduce the amount after
 * the discount and before tax, capped at the discounted subtotal — the taxable
 * amount never drops below zero — so tax is charged on (subtotal - discount -
 * points). `pointsCents` is the applied amount; excess points are not consumed.
 */
export function quoteWithPoints(lines: Line[], region: string, taxRate: number, discountCode: string | undefined, pointsCents: number): RedeemedQuote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const appliedPointsCents = Math.max(0, Math.min(pointsCents, subtotalCents - discount));
  const taxableCents = subtotalCents - discount - appliedPointsCents;
  const taxCents = taxOn(taxableCents, taxRate);
  return { region, subtotalCents, discountCents: discount, pointsCents: appliedPointsCents, taxCents, totalCents: taxableCents + taxCents };
}
