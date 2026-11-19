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
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const taxCents = taxOn(subtotalCents - discount, taxRate);
  return { region, subtotalCents, discountCents: discount, taxCents, totalCents: subtotalCents - discount + taxCents };
}

/** Points are worth one cent each and reduce the taxable, post-discount amount. */
export function quoteWithPoints(lines: Line[], region: string, taxRate: number, points: number, discountCode?: string): PointsQuote {
  const ordinary = quote(lines, region, taxRate, discountCode);
  const pointsAppliedCents = Math.min(points, ordinary.subtotalCents - ordinary.discountCents);
  const taxableCents = ordinary.subtotalCents - ordinary.discountCents - pointsAppliedCents;
  const taxCents = taxOn(taxableCents, taxRate);
  return { ...ordinary, pointsAppliedCents, taxCents, totalCents: taxableCents + taxCents };
}
