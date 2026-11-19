import { quote, quoteWithPoints, type Line, type Quote, type QuoteWithPoints } from "../domain/quote.ts";
import { getTaxRate } from "../integration/tax-rates.ts";

/** Use case: produce a customer-facing quote for a cart in a region. */
export function quoteForCart(lines: Line[], region: string, discountCode?: string): Quote {
  return quote(lines, region, getTaxRate(region), discountCode);
}

/** Use case: quote an order as stored. */
export function quoteForOrder(order: { lines: Line[]; region: string; discountCode?: string }): Quote {
  return quoteForCart(order.lines, order.region, order.discountCode);
}

/** Use case: quote a cart with loyalty points applied (after discount, before tax). */
export function quoteForCartWithPoints(
  lines: Line[], region: string, discountCode: string | undefined, pointsCents: number,
): QuoteWithPoints {
  return quoteWithPoints(lines, region, getTaxRate(region), discountCode, pointsCents);
}
