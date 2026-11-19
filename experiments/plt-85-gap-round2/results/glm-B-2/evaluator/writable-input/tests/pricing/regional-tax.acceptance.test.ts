/**
 * Acceptance PRC-TAX-001
 * taxCents = (subtotal - discount) x configured regional rate (rounded to the nearest cent)
 * and totalCents = subtotalCents - discountCents + taxCents
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteForCart } from "../../src/pricing/application/quote-service.ts";

test("PRC-TAX-001: German quote includes 19% tax", () => {
  const q = quoteForCart([{ sku: "a", unitPriceCents: 2500, quantity: 4 }], "DE");
  assert.deepEqual(q, { region: "DE", subtotalCents: 10000, discountCents: 0, taxCents: 1900, totalCents: 11900 });
});
