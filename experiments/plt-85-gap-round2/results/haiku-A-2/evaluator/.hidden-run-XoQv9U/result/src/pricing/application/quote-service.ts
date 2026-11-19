import { quote, type Line, type Quote } from "../domain/quote.ts";
import { getTaxRate } from "../integration/tax-rates.ts";

/** Use case: produce a customer-facing quote for a cart in a region. */
export function quoteForCart(lines: Line[], region: string, discountCode?: string, pointsCents = 0): Quote {
  return quote(lines, region, getTaxRate(region), discountCode, pointsCents);
}

/** Use case: quote an order as stored, optionally with loyalty points applied. */
export function quoteForOrder(order: { lines: Line[]; region: string; discountCode?: string }, pointsCents = 0): Quote {
  return quoteForCart(order.lines, order.region, order.discountCode, pointsCents);
}
