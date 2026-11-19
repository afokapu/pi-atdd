import { discountCents as discountCentsForSubtotal } from "./discount.ts";

export type Line = { sku: string; unitPriceCents: number; quantity: number };
export type Quote = { region: string; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number };
export type RedemptionQuote = Quote & { pointsAppliedCents: number };

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
  const discount = discountCentsForSubtotal(subtotalCents, discountCode);
  const taxCents = taxOn(subtotalCents - discount, taxRate);
  return { region, subtotalCents, discountCents: discount, taxCents, totalCents: subtotalCents - discount + taxCents };
}

/** Price an order after applying loyalty points (one point is one cent). */
export function quoteWithPoints(lines: Line[], region: string, taxRate: number, pointsAppliedCents: number,
  discountCode?: string): RedemptionQuote {
  const subtotalCents = subtotal(lines);
  const discountCents = discountCentsForSubtotal(subtotalCents, discountCode);
  const points = Math.min(pointsAppliedCents, subtotalCents - discountCents);
  const taxableCents = subtotalCents - discountCents - points;
  const taxCents = taxOn(taxableCents, taxRate);
  return { region, subtotalCents, discountCents, pointsAppliedCents: points, taxCents, totalCents: taxableCents + taxCents };
}
