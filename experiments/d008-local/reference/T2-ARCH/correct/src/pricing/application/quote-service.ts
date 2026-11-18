import { quote, type Line, type Quote } from "../domain/quote.ts";
import { getTaxRate } from "../integration/tax-rates.ts";

/** Use case: produce a customer-facing quote for a cart in a region. */
export function quoteForCart(lines: Line[], region: string): Quote {
  return quote(lines, region, getTaxRate(region));
}
