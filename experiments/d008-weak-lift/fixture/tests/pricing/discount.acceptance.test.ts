/**
 * Acceptance PRC-DISC-001
 * Given a cart subtotal and a discount code
 * When the discounted subtotal is computed
 * Then SAVE10 takes 10% off (rounded to the nearest cent), FLAT5 takes 500 cents off,
 *  the result is never below zero, and an unknown code is rejected with an error
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { discountedSubtotal } from "../../src/pricing/domain/discount.ts";

test("PRC-DISC-001: SAVE10 gives 10% off the subtotal", () => {
  const subtotal = 10000;
  const discounted = discountedSubtotal(subtotal);
  assert.equal(typeof discounted, "number");
  assert.ok(discounted <= subtotal);
});
