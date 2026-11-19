/**
 * LOY-002 domain rules: points apply to a payable amount capped and never below
 * zero; consumption draws non-expired lots earliest expiry first; reversal
 * restores the recorded allocations unless the lot expired meanwhile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applicablePoints,
  planConsumption,
  planRestoration,
  spendablePoints,
  type PointsLot,
} from "../../src/loyalty/domain/points.ts";
import { quoteForOrderWithPoints } from "../../src/pricing/application/quote-service.ts";
import type { Line } from "../../src/pricing/domain/quote.ts";

const lot = (id: string, points: number, expiresAt: string): PointsLot =>
  ({ id, customerId: "c", points, expiresAt: new Date(expiresAt) });

const now = new Date("2026-11-19T12:00:00Z");

test("applicablePoints: capped to the amount, never negative, excess not consumed", () => {
  assert.equal(applicablePoints(500, 10000), 500); // below the amount: all applied
  assert.equal(applicablePoints(10000, 500), 500); // reduction equal to the base
  assert.equal(applicablePoints(9999, 500), 500); // larger than the base: capped, excess stays
  assert.equal(applicablePoints(0, 500), 0);
  assert.equal(applicablePoints(100, 0), 0);
  assert.equal(applicablePoints(-5, 500), 0);
});

test("spendablePoints ignores empty and expired lots", () => {
  const lots = [lot("a", 300, "2027-01-31T00:00:00Z"), lot("b", 500, "2025-01-01T00:00:00Z"), lot("c", 0, "2027-01-31T00:00:00Z")];
  assert.equal(spendablePoints(lots, now), 300);
});

test("planConsumption: earliest expiry first, expired lots skipped, exact total", () => {
  const lots = [
    lot("late", 300, "2026-12-31T00:00:00Z"),
    lot("expired", 1000, "2025-06-30T00:00:00Z"),
    lot("early", 500, "2026-12-01T00:00:00Z"),
  ];
  assert.deepEqual(planConsumption(lots, 600, now), [
    { lotId: "early", points: 500 }, // expires first
    { lotId: "late", points: 100 },
  ]);
});

test("planConsumption: same expiry broken by lot id, zero points draws nothing", () => {
  const lots = [lot("b", 100, "2027-01-01T00:00:00Z"), lot("a", 100, "2027-01-01T00:00:00Z")];
  assert.deepEqual(planConsumption(lots, 100, now), [{ lotId: "a", points: 100 }]);
  assert.deepEqual(planConsumption(lots, 0, now), []);
});

test("planRestoration: restored to original lots, expired lots forfeited", () => {
  const lots = [lot("early", 0, "2026-12-01T00:00:00Z"), lot("late", 100, "2027-06-30T00:00:00Z")];
  const allocations = [{ lotId: "early", points: 500 }, { lotId: "late", points: 300 }];
  const outcome = planRestoration(allocations, lots, new Date("2027-01-15T00:00:00Z"));
  assert.deepEqual(outcome.restored, [{ lotId: "late", points: 300 }]);
  assert.deepEqual(outcome.forfeited, [{ lotId: "early", points: 500 }]);
});

test("quoteWithPoints: points reduce after discount, before tax, in integer cents", () => {
  const lines: Line[] = [{ sku: "sku-1", unitPriceCents: 2500, quantity: 4 }];
  // 10000 subtotal, SAVE10 → 1000 discount, 8000 points applied → taxable 1000, 19% = 190
  const q = quoteForOrderWithPoints({ lines, region: "DE", discountCode: "SAVE10" }, 8000);
  assert.deepEqual(q, { region: "DE", subtotalCents: 10000, discountCents: 1000, pointsCents: 8000, taxCents: 190, totalCents: 1190 });
});

test("quoteWithPoints: reduction equal to the base → total zero; larger is capped", () => {
  const lines: Line[] = [{ sku: "a", unitPriceCents: 900, quantity: 1 }];
  const equal = quoteForOrderWithPoints({ lines, region: "DE" }, 900);
  assert.deepEqual(equal, { region: "DE", subtotalCents: 900, discountCents: 0, pointsCents: 900, taxCents: 0, totalCents: 0 });
  const over = quoteForOrderWithPoints({ lines, region: "DE" }, 5000);
  assert.equal(over.pointsCents, 900); // excess points are not consumed
  assert.equal(over.totalCents, 0);
});

test("quoteWithPoints: tax rounding half case and zero points input", () => {
  const lines: Line[] = [{ sku: "a", unitPriceCents: 2050, quantity: 1 }];
  // 2050 − 1000 points = 1050 taxable; 19% = 199.5 → rounds to 200
  const half = quoteForOrderWithPoints({ lines, region: "DE" }, 1000);
  assert.deepEqual(half, { region: "DE", subtotalCents: 2050, discountCents: 0, pointsCents: 1000, taxCents: 200, totalCents: 1250 });
  const none = quoteForOrderWithPoints({ lines, region: "DE", discountCode: "SAVE10" }, 0);
  assert.deepEqual(none, { region: "DE", subtotalCents: 2050, discountCents: 205, pointsCents: 0, taxCents: 351, totalCents: 2196 });
});
