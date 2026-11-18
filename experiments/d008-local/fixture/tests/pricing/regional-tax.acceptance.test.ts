/**
 * Acceptance PRC-TAX-001
 * Given cart lines and a region with a configured tax rate
 * When a quote is requested through the quote service
 * Then taxCents = subtotal x configured regional rate (rounded to the nearest cent)
 *  and totalCents = subtotalCents + taxCents
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteForCart } from "../../src/pricing/application/quote-service.ts";

test("PRC-TAX-001: German quote includes 19% tax", () => {
  const q = quoteForCart([{ sku: "a", unitPriceCents: 2500, quantity: 4 }], "DE");
  assert.equal(q.subtotalCents, 10000);
  assert.equal(q.taxCents, 1900);
  assert.equal(q.totalCents, 11900);
});
