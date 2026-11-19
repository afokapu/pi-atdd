import { quote, taxOn, type Line, type PointsQuote, type Quote } from "../domain/quote.ts";
import { getTaxRate } from "../integration/tax-rates.ts";

/** Use case: produce a customer-facing quote for a cart in a region. */
export function quoteForCart(lines: Line[], region: string, discountCode?: string): Quote {
  return quote(lines, region, getTaxRate(region), discountCode);
}

/** Use case: quote an order as stored. */
export function quoteForOrder(order: { lines: Line[]; region: string; discountCode?: string }): Quote {
  return quoteForCart(order.lines, order.region, order.discountCode);
}

/** Price an order after points: discount first, then points, then tax. */
export function quoteForOrderWithPoints(
  order: { lines: Line[]; region: string; discountCode?: string }, pointsAppliedCents: number,
): PointsQuote {
  const base = quoteForOrder(order);
  const discountedCents = base.subtotalCents - base.discountCents;
  const applied = Math.min(Math.max(0, pointsAppliedCents), discountedCents);
  const taxCents = taxOn(discountedCents - applied, getTaxRate(order.region));
  return {
    region: base.region,
    subtotalCents: base.subtotalCents,
    discountCents: base.discountCents,
    pointsAppliedCents: applied,
    taxCents,
    totalCents: discountedCents - applied + taxCents,
  };
}
