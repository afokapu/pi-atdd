/**
 * Acceptance PRC-DISC-001
 * SAVE10 takes 10% off (rounded to the nearest cent), FLAT5 takes 500 cents off,
 * the result is never below zero, and an unknown code is rejected with an error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { discountedSubtotal, UnknownDiscountCodeError } from "../../src/pricing/domain/discount.ts";

test("PRC-DISC-001: discount codes", () => {
  assert.equal(discountedSubtotal(10005, "SAVE10"), 9004);
  assert.equal(discountedSubtotal(10000, "FLAT5"), 9500);
  assert.equal(discountedSubtotal(300, "FLAT5"), 0);
  assert.equal(discountedSubtotal(10000), 10000);
  assert.throws(() => discountedSubtotal(10000, "NOPE"), UnknownDiscountCodeError);
});
