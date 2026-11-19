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

/**
 * Price a cart: subtotal, then discount, then loyalty points (`pointsCents`, capped by the
 * caller), then tax on what remains. Points may not exceed the discounted amount.
 */
export function quote(lines: Line[], region: string, taxRate: number, discountCode?: string, pointsCents = 0): Quote {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const payable = subtotalCents - discount;
  if (!Number.isInteger(pointsCents) || pointsCents < 0 || pointsCents > payable)
    throw new RangeError("points must be between 0 and the discounted subtotal");
  const taxable = payable - pointsCents;
  const taxCents = taxOn(taxable, taxRate);
  return { region, subtotalCents, discountCents: discount, taxCents, totalCents: taxable + taxCents };
}
