/**
 * Unit tests for pricing a cart part-paid with loyalty points: points are
 * applied after the discount and before tax, never push the amount below
 * zero, and tax is computed once on the reduced base.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteWithPoints } from "../../src/pricing/domain/quote.ts";

const lines = [{ sku: "sku-1", unitPriceCents: 2500, quantity: 4 }]; // subtotal 10000

test("points apply after discount and before tax", () => {
  // discount 1000, points 400 -> tax on 8600 at 19% = 1634, total 10234
  const q = quoteWithPoints(lines, "DE", 0.19, "SAVE10", 400);
  assert.deepEqual(q, {
    region: "DE", subtotalCents: 10000, discountCents: 1000,
    pointsCents: 400, taxCents: 1634, totalCents: 10234,
  });
});

test("points never reduce the payable amount below zero; surplus is not applied", () => {
  const q = quoteWithPoints(lines, "DE", 0.19, undefined, 50000);
  assert.deepEqual(q, {
    region: "DE", subtotalCents: 10000, discountCents: 0,
    pointsCents: 10000, taxCents: 0, totalCents: 0,
  });
});

test("zero points behave like a plain quote", () => {
  const q = quoteWithPoints(lines, "DE", 0.19, undefined, 0);
  assert.equal(q.pointsCents, 0);
  assert.equal(q.totalCents, 10000 + Math.round(10000 * 0.19));
});
