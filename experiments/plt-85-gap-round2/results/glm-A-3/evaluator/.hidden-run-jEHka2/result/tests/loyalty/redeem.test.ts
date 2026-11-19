import { test } from "node:test";
import assert from "node:assert/strict";
import { availablePoints, planConsumption, planRefund } from "../../src/loyalty/domain/redeem.ts";
import { quoteWithPoints } from "../../src/pricing/domain/quote.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const at = new Date("2026-06-01T00:00:00Z");
const lot = (id: string, points: number, expiresAt: string): PointsLot => ({ id, customerId: "c", points, expiresAt: new Date(expiresAt) });

const lots = [
  lot("late", 300, "2026-12-31T00:00:00Z"),
  lot("soon", 500, "2026-07-01T00:00:00Z"),
  lot("expired", 999, "2026-01-01T00:00:00Z"),
  lot("empty", 0, "2027-01-01T00:00:00Z"),
];

test("availablePoints ignores expired lots", () => {
  assert.equal(availablePoints(lots, at), 800);
});

test("planConsumption consumes non-expired lots, earliest expiry first", () => {
  assert.deepEqual(planConsumption(lots, 600, at), [
    { lotId: "soon", points: 500 },
    { lotId: "late", points: 100 },
  ]);
  assert.deepEqual(planConsumption(lots, 100, at), [{ lotId: "soon", points: 100 }]);
});

test("planConsumption plans less than requested when the balance is short", () => {
  assert.deepEqual(planConsumption(lots, 5000, at), [{ lotId: "soon", points: 500 }, { lotId: "late", points: 300 }]);
});

test("planRefund refunds to the original lots and forfeits expired or missing ones", () => {
  const consumed = [
    { lotId: "soon", points: 500 },
    { lotId: "expired", points: 100 },
    { lotId: "ghost", points: 50 },
    { lotId: "late", points: 10 },
  ];
  const later = new Date("2026-08-01T00:00:00Z"); // "soon" expired in the meantime
  assert.deepEqual(planRefund(consumed, lots, at), {
    refunds: [{ lotId: "soon", points: 500 }, { lotId: "late", points: 10 }],
    forfeited: [{ lotId: "expired", points: 100 }, { lotId: "ghost", points: 50 }],
  });
  assert.deepEqual(planRefund(consumed, lots, later).refunds, [{ lotId: "late", points: 10 }]);
});

test("quoteWithPoints applies points after discount and before tax, never below zero", () => {
  const lines = [{ sku: "x", unitPriceCents: 2500, quantity: 4 }]; // subtotal 10000
  assert.deepEqual(quoteWithPoints(lines, "DE", 0.19, "SAVE10", 500), {
    region: "DE", subtotalCents: 10000, discountCents: 1000, pointsCents: 500, taxCents: 1615, totalCents: 10115,
  });
  assert.deepEqual(quoteWithPoints(lines, "DE", 0.19, "SAVE10", 9000), {
    region: "DE", subtotalCents: 10000, discountCents: 1000, pointsCents: 9000, taxCents: 0, totalCents: 0,
  });
  assert.deepEqual(quoteWithPoints(lines, "DE", 0.19, "SAVE10", 99999).pointsCents, 9000);
  assert.deepEqual(quoteWithPoints(lines, "DE", 0.19, undefined, 0), {
    region: "DE", subtotalCents: 10000, discountCents: 0, pointsCents: 0, taxCents: 1900, totalCents: 11900,
  });
});
