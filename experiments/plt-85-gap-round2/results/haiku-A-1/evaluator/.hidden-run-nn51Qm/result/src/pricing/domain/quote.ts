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

/**
 * Price a cart partly paid with points: subtotal, discount, then points (never more than the
 * discounted amount), then tax on what remains.
 */
export function quoteWithPoints(
  lines: Line[], region: string, taxRate: number, discountCode: string | undefined, pointsCents: number,
): Quote & { pointsAppliedCents: number } {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const payable = subtotalCents - discount;
  if (!Number.isInteger(pointsCents) || pointsCents < 0 || pointsCents > payable)
    throw new RangeError("points must be between 0 and the payable amount");
  const taxCents = taxOn(payable - pointsCents, taxRate);
  return {
    region, subtotalCents, discountCents: discount, pointsAppliedCents: pointsCents, taxCents,
    totalCents: payable - pointsCents + taxCents,
  };
}
