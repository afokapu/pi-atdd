import { discountCents } from "./discount.ts";

export type Line = { sku: string; unitPriceCents: number; quantity: number };
export type Quote = { region: string; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number };
export type QuoteWithPoints = Quote & {
  /** Value of loyalty points applied, in cents (a reduction after discount, before tax). */
  pointsCents: number;
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
 * Price a cart partly with loyalty points, in integer cents. Adjustment order:
 * subtotal → discount → points (capped so the base never drops below zero) →
 * tax, computed exactly once on the fully reduced base → total.
 * Callers pass the applied value in cents, already capped to what the customer
 * can spend (see loyalty domain `applicablePoints`); it is clamped here again
 * as the domain invariant "the payable amount is never below zero".
 */
export function quoteWithPoints(lines: Line[], region: string, taxRate: number, discountCode: string | undefined, pointsCents: number): QuoteWithPoints {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const applied = Math.max(0, Math.min(pointsCents, subtotalCents - discount));
  const taxableCents = subtotalCents - discount - applied;
  const taxCents = taxOn(taxableCents, taxRate);
  return { region, subtotalCents, discountCents: discount, pointsCents: applied, taxCents, totalCents: taxableCents + taxCents };
}
