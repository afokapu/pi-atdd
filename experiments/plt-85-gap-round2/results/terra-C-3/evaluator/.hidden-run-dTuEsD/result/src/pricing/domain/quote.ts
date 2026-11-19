import { discountCents } from "./discount.ts";

export type Line = { sku: string; unitPriceCents: number; quantity: number };
export type Quote = { region: string; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number };
export type PointsQuote = Quote & { pointsAppliedCents: number };

export function subtotal(lines: Line[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
}

/** Tax on a taxable amount, rounded to the nearest cent. `rate` is fractional (0.19 = 19%). */
export function taxOn(taxableCents: number, rate: number): number {
  return Math.round(taxableCents * rate);
}

/** Price a cart: subtotal, then discount, then tax on the discounted amount. */
export function quote(lines: Line[], region: string, taxRate: number, discountCode?: string): Quote {
  const priced = quoteWithPoints(lines, region, taxRate, 0, discountCode);
  return {
    region: priced.region,
    subtotalCents: priced.subtotalCents,
    discountCents: priced.discountCents,
    taxCents: priced.taxCents,
    totalCents: priced.totalCents,
  };
}

/**
 * Price in the required adjustment order: discount, loyalty points, then tax.
 * A point is worth one cent, so all calculations remain integer minor units.
 */
export function quoteWithPoints(lines: Line[], region: string, taxRate: number, requestedPoints: number, discountCode?: string): PointsQuote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const discountedCents = subtotalCents - discount;
  const pointsAppliedCents = Math.min(Math.max(0, requestedPoints), discountedCents);
  const taxableCents = discountedCents - pointsAppliedCents;
  const taxCents = taxOn(taxableCents, taxRate);
  return { region, subtotalCents, discountCents: discount, pointsAppliedCents, taxCents, totalCents: taxableCents + taxCents };
}
