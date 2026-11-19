import { test } from "node:test";
import assert from "node:assert/strict";
import { allocatePoints, InsufficientPointsError, restoreAllocations, type PointsLot } from "../../src/loyalty/domain/points.ts";
import { quoteWithPoints } from "../../src/pricing/domain/quote.ts";

const AT = new Date("2026-11-19T12:00:00Z");
const lot = (id: string, points: number, expiresAt: string): PointsLot =>
  ({ id, customerId: "alice", points, expiresAt: new Date(expiresAt) });

test("allocation draws earliest expiry first and skips lots expiring at or before now", () => {
  const lots = [
    lot("late", 100, "2027-06-01T00:00:00Z"),
    lot("exact", 50, "2026-11-19T12:00:00Z"), // expires at the instant: not usable
    lot("soon", 40, "2026-12-01T00:00:00Z"),
  ];
  assert.deepEqual(allocatePoints(lots, 60, AT), [{ lotId: "soon", points: 40 }, { lotId: "late", points: 20 }]);
});

test("allocation throws when usable lots cannot cover the points", () => {
  assert.throws(() => allocatePoints([lot("a", 10, "2027-01-01T00:00:00Z")], 11, AT), InsufficientPointsError);
});

test("restore returns points to original lots and forfeits lots expired by then", () => {
  const lots = [lot("a", 0, "2026-12-01T00:00:00Z"), lot("b", 100, "2027-01-01T00:00:00Z")];
  const later = new Date("2026-12-05T00:00:00Z");
  const result = restoreAllocations(lots, [{ lotId: "a", points: 30 }, { lotId: "b", points: 20 }], later);
  assert.deepEqual(result.forfeited, [{ lotId: "a", points: 30 }]);
  assert.deepEqual(result.restored, [{ lotId: "b", points: 20 }]);
  assert.deepEqual(result.changed.map(l => [l.id, l.points]), [["b", 120]]);
  assert.equal(lots[1]!.points, 100, "input lots are not mutated");
});

test("quote with points: reduction equal to the base leaves total zero", () => {
  const q = quoteWithPoints([{ sku: "x", unitPriceCents: 1000, quantity: 1 }], "DE", 0.19, 1000);
  assert.deepEqual(q, { region: "DE", subtotalCents: 1000, discountCents: 0, pointsAppliedCents: 1000, taxCents: 0, totalCents: 0 });
});

test("quote with points: half-cent tax rounds once, on the amount after points", () => {
  // after discount 1005 -> points 5 -> taxable 1000 -> tax 190 exactly
  const q = quoteWithPoints([{ sku: "x", unitPriceCents: 1005, quantity: 1 }], "DE", 0.19, 5);
  assert.equal(q.taxCents, 190);
  assert.equal(q.totalCents, 1190);
});

test("quote with zero points equals the plain quote's amounts", () => {
  const q = quoteWithPoints([{ sku: "x", unitPriceCents: 10000, quantity: 1 }], "DE", 0.19, 0, "SAVE10");
  assert.deepEqual(q, { region: "DE", subtotalCents: 10000, discountCents: 1000, pointsAppliedCents: 0, taxCents: 1710, totalCents: 10710 });
});
