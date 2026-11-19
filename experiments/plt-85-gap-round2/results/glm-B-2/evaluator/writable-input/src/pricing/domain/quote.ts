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

/** A quote that additionally shows how many loyalty points (in cents) were applied. */
export type QuoteWithPoints = Quote & { pointsCents: number };

/**
 * Price a cart with loyalty points applied: points reduce the amount after
 * discounts and before tax. The applied amount never exceeds the discounted
 * subtotal (the amount is never below zero), and points beyond it are not
 * applied — the caller must consume only `pointsCents` from the ledger.
 */
export function quoteWithPoints(
  lines: Line[], region: string, taxRate: number, discountCode: string | undefined, pointsCents: number,
): QuoteWithPoints {
  const subtotalCents = subtotal(lines);
  const discount = discountCents(subtotalCents, discountCode);
  const applied = Math.max(0, Math.min(pointsCents, subtotalCents - discount));
  const taxable = subtotalCents - discount - applied;
  const taxCents = taxOn(taxable, taxRate);
  return { region, subtotalCents, discountCents: discount, pointsCents: applied, taxCents, totalCents: taxable + taxCents };
}
