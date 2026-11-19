import { quote, quoteWithPoints, type Line, type PointsQuote, type Quote } from "../domain/quote.ts";
import { getTaxRate } from "../integration/tax-rates.ts";

/** Use case: produce a customer-facing quote for a cart in a region. */
export function quoteForCart(lines: Line[], region: string, discountCode?: string): Quote {
  return quote(lines, region, getTaxRate(region), discountCode);
}

/** Use case: quote an order as stored. */
export function quoteForOrder(order: { lines: Line[]; region: string; discountCode?: string }): Quote {
  return quoteForCart(order.lines, order.region, order.discountCode);
}

/** Quote an order after its already-recorded point reductions. */
export function quoteForOrderWithPoints(order: { lines: Line[]; region: string; discountCode?: string }, points: number): PointsQuote {
  return quoteWithPoints(order.lines, order.region, getTaxRate(order.region), points, order.discountCode);
}
