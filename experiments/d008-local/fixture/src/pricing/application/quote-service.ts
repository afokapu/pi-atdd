import { quote, type Line, type Quote } from "../domain/quote.ts";

/** Use case: produce a customer-facing quote for a cart in a region. */
export function quoteForCart(lines: Line[], region: string): Quote {
  return quote(lines, region);
}
