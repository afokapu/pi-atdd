import { quote, withPoints, type Line, type PointsQuote, type Quote } from "../domain/quote.ts";
import { getTaxRate } from "../integration/tax-rates.ts";

/** Use case: produce a customer-facing quote for a cart in a region. */
export function quoteForCart(lines: Line[], region: string, discountCode?: string): Quote {
  return quote(lines, region, getTaxRate(region), discountCode);
}

/** Use case: quote an order as stored. */
export function quoteForOrder(order: { lines: Line[]; region: string; discountCode?: string }): Quote {
  return quoteForCart(order.lines, order.region, order.discountCode);
}

/** Use case: quote an order with a loyalty-points payment (points already converted to cents). */
export function quoteWithPoints(order: { lines: Line[]; region: string; discountCode?: string },
  pointsApplied: number, pointsCents: number): PointsQuote {
  return withPoints(quoteForOrder(order), getTaxRate(order.region), pointsApplied, pointsCents);
}
