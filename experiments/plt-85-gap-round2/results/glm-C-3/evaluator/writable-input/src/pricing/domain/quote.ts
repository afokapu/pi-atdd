import { discountCents } from "./discount.ts";

export type Line = { sku: string; unitPriceCents: number; quantity: number };
export type Quote = { region: string; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number };
export type QuoteWithPoints = Quote & { pointsAppliedCents: number };

export function subtotal(lines: Line[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
}

/** Tax on a taxable amount, rounded to the nearest cent. `rate` is fractional (0.19 = 19%). */
export function taxOn(taxableCents: number, rate: number): number {
  return Math.round(taxableCents * rate);
}

/**
 * Price a cart paying part of it with loyalty points, in integer cents.
 * Adjustment order (every reduction applied before tax): subtotal, discount,
 * then points — 100 points = 1 EUR, so `points` maps 1:1 to cents — then tax
 * on the remaining taxable base: `tax = Math.round(taxable * rate)`, the
 * single rounding step for the derived amounts. Applied points are clamped so
 * the payable amount never drops below zero; excess points are not consumed.
 */
export function quoteWithPoints(lines: Line[], region: string, taxRate: number, discountCode: string | undefined, points: number): QuoteWithPoints {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const pointsAppliedCents = Math.max(0, Math.min(points, subtotalCents - discount));
  const taxCents = taxOn(subtotalCents - discount - pointsAppliedCents, taxRate);
  return { region, subtotalCents, discountCents: discount, pointsAppliedCents, taxCents, totalCents: subtotalCents - discount - pointsAppliedCents + taxCents };
}

/** Price a cart: subtotal, then discount, then tax on the discounted amount. */
export function quote(lines: Line[], region: string, taxRate: number, discountCode?: string): Quote {
  const priced = quoteWithPoints(lines, region, taxRate, discountCode, 0);
  const { pointsAppliedCents, ...withoutPoints } = priced;
  return withoutPoints;
}
