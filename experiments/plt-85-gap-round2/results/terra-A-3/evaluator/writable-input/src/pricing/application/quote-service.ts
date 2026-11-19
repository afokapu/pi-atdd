import { quote, taxOn, type Line, type Quote } from "../domain/quote.ts";
import { getTaxRate } from "../integration/tax-rates.ts";

/** Use case: produce a customer-facing quote for a cart in a region. */
export function quoteForCart(lines: Line[], region: string, discountCode?: string): Quote {
  return quote(lines, region, getTaxRate(region), discountCode);
}

/** Use case: quote an order as stored. */
export function quoteForOrder(order: { lines: Line[]; region: string; discountCode?: string }): Quote {
  return quoteForCart(order.lines, order.region, order.discountCode);
}

/** Price an order after a loyalty redemption. One point is worth one cent. */
export function quoteForOrderWithPoints(order: { lines: Line[]; region: string; discountCode?: string }, pointsAppliedCents: number): Quote & { pointsAppliedCents: number } {
  const beforePoints = quoteForOrder(order);
  const applied = Math.min(Math.max(0, pointsAppliedCents), beforePoints.subtotalCents - beforePoints.discountCents);
  const taxableCents = beforePoints.subtotalCents - beforePoints.discountCents - applied;
  const taxCents = taxOn(taxableCents, getTaxRate(order.region));
  return {
    region: order.region,
    subtotalCents: beforePoints.subtotalCents,
    discountCents: beforePoints.discountCents,
    pointsAppliedCents: applied,
    taxCents,
    totalCents: taxableCents + taxCents,
  };
}
