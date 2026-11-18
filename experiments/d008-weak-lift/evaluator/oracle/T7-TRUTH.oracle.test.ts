import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discountedSubtotal } from '../src/pricing/domain/discount.ts';

test('oracle: SAVE10 actually applies ten percent to varied subtotals and rounds non-ties to cents', () => {
  for (const [subtotal, expected] of [[10000, 9000], [1234, 1111], [101, 91], [109, 98], [1, 1], [0, 0], [7777, 6999]]) {
    assert.equal(discountedSubtotal(subtotal, 'SAVE10'), expected, `SAVE10 on ${subtotal}`);
  }
});

test('oracle: SAVE10 half-cent ties permit rounding either the discount or the remaining subtotal', () => {
  for (const subtotal of [5, 15, 105, 1235]) {
    const actual = discountedSubtotal(subtotal, 'SAVE10');
    const discountFirst = subtotal - Math.round(subtotal * 0.1);
    const remainderFirst = Math.round(subtotal * 0.9);
    assert.ok(actual === discountFirst || actual === remainderFirst, `not a nearest-cent result for ${subtotal}`);
    assert.ok(actual >= 0);
  }
});

test('oracle: FLAT5 removes exactly 500 cents and clamps low or empty carts to zero', () => {
  for (const [subtotal, expected] of [[10000, 9500], [1234, 734], [501, 1], [500, 0], [499, 0], [1, 0], [0, 0]]) {
    assert.equal(discountedSubtotal(subtotal, 'FLAT5'), expected, `FLAT5 on ${subtotal}`);
  }
});

test('oracle: unknown codes raise an error, including on a zero subtotal', () => {
  for (const subtotal of [0, 79, 10000]) {
    for (const code of ['NOT-A-REAL-PROMOTION-79', 'SAVE79', 'FLAT79']) {
      assert.throws(() => discountedSubtotal(subtotal, code), Error);
    }
  }
});

test('oracle: alternating known codes has no cached-code or previous-subtotal effect', () => {
  assert.equal(discountedSubtotal(2000, 'FLAT5'), 1500);
  assert.equal(discountedSubtotal(2000, 'SAVE10'), 1800);
  assert.equal(discountedSubtotal(300, 'FLAT5'), 0);
  assert.equal(discountedSubtotal(300, 'SAVE10'), 270);
  assert.equal(discountedSubtotal(2000, 'FLAT5'), 1500);
});
