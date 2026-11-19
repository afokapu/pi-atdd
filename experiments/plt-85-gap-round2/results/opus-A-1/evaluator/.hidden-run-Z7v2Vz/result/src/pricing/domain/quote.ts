import { discountCents } from "./discount.ts";

export type Line = { sku: string; unitPriceCents: number; quantity: number };
export type Quote = {
  region: string; subtotalCents: number; discountCents: number;
  /** Present only when loyalty points were applied to the order. */
  pointsAppliedCents?: number;
  taxCents: number; totalCents: number;
};

export function subtotal(lines: Line[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
}

/** Tax on a taxable amount, rounded to the nearest cent. `rate` is fractional (0.19 = 19%). */
export function taxOn(taxableCents: number, rate: number): number {
  return Math.round(taxableCents * rate);
}

/**
 * Price a cart: subtotal, then discount, then points (capped so the amount never goes
 * below zero), then tax on what remains. `pointsCents` undefined = no points field.
 */
export function quote(lines: Line[], region: string, taxRate: number, discountCode?: string, pointsCents?: number): Quote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const afterDiscount = subtotalCents - discount;
  if (pointsCents === undefined) {
    const taxCents = taxOn(afterDiscount, taxRate);
    return { region, subtotalCents, discountCents: discount, taxCents, totalCents: afterDiscount + taxCents };
  }
  const points = Math.max(0, Math.min(pointsCents, afterDiscount));
  const taxable = afterDiscount - points;
  const taxCents = taxOn(taxable, taxRate);
  return { region, subtotalCents, discountCents: discount, pointsAppliedCents: points, taxCents, totalCents: taxable + taxCents };
}
