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

/** A payment quote taxes the amount left after both discounts and points. */
export function quoteForOrderWithPoints(
  order: { lines: Line[]; region: string; discountCode?: string },
  requestedPointsCents: number,
): Quote & { pointsAppliedCents: number } {
  const beforePoints = quoteForOrder(order);
  const taxableBeforePoints = beforePoints.subtotalCents - beforePoints.discountCents;
  const pointsAppliedCents = Math.min(Math.max(0, requestedPointsCents), taxableBeforePoints);
  const taxCents = taxOn(taxableBeforePoints - pointsAppliedCents, getTaxRate(order.region));
  return {
    region: order.region,
    subtotalCents: beforePoints.subtotalCents,
    discountCents: beforePoints.discountCents,
    pointsAppliedCents,
    taxCents,
    totalCents: taxableBeforePoints - pointsAppliedCents + taxCents,
  };
}
