import { quote, quoteWithPoints, type Line, type Quote, type RedemptionQuote } from "../domain/quote.ts";
import { getTaxRate } from "../integration/tax-rates.ts";

/** Use case: produce a customer-facing quote for a cart in a region. */
export function quoteForCart(lines: Line[], region: string, discountCode?: string): Quote {
  return quote(lines, region, getTaxRate(region), discountCode);
}

/** Use case: quote an order as stored. */
export function quoteForOrder(order: { lines: Line[]; region: string; discountCode?: string }): Quote {
  return quoteForCart(order.lines, order.region, order.discountCode);
}

/** Quote an order after loyalty points have reduced its discounted subtotal. */
export function quoteForOrderWithPoints(order: { lines: Line[]; region: string; discountCode?: string },
  pointsAppliedCents: number): RedemptionQuote {
  return quoteWithPoints(order.lines, order.region, getTaxRate(order.region), pointsAppliedCents, order.discountCode);
}
