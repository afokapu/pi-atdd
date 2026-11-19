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

export type RedeemQuote = Quote & { pointsAppliedCents: number };

/**
 * Price a cart paid partly with points: subtotal, then discount, then points, then tax.
 * Points are capped at the discounted amount, so the taxable amount never goes below zero;
 * requested points beyond that cap are not consumed. Kept separate from `quote()` so the
 * plain quote shape stays unchanged.
 */
export function quoteWithPoints(
  lines: Line[], region: string, taxRate: number, requestedPointsCents: number, discountCode?: string,
): RedeemQuote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const afterDiscount = subtotalCents - discount;
  const pointsApplied = Math.max(0, Math.min(requestedPointsCents, afterDiscount));
  const taxable = afterDiscount - pointsApplied;
  const taxCents = taxOn(taxable, taxRate);
  return {
    region, subtotalCents, discountCents: discount, pointsAppliedCents: pointsApplied,
    taxCents, totalCents: taxable + taxCents,
  };
}
