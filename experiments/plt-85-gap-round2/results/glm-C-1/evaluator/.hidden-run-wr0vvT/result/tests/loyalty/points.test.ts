/**
 * Unit tests for the loyalty points domain: consumption planning (earliest
 * expiry first, expiry- and emptiness-aware, capped) and restoration planning
 * (original lots only, expired lots forfeited).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { consumablePoints, planConsumption, planRestoration, type PointsLot } from "../../src/loyalty/domain/points.ts";

const now = () => new Date("2026-11-19T12:00:00Z");

const lot = (id: string, points: number, expiresAt: string): PointsLot => ({
  id, customerId: "alice", points, expiresAt: new Date(expiresAt),
});

test("consumablePoints caps the request at the amount due (1 point = 1 cent)", () => {
  assert.equal(consumablePoints(500, 300), 300);
  assert.equal(consumablePoints(100, 10000), 100);
  assert.equal(consumablePoints(400, 0), 0);
});

test("planConsumption draws earliest-expiring non-expired lots first", () => {
  const lots = [
    lot("late", 500, "2026-12-31T00:00:00Z"),
    lot("early", 500, "2026-12-01T00:00:00Z"),
    lot("expired", 500, "2025-01-01T00:00:00Z"),
  ];
  const plan = planConsumption(lots, 600, now());
  assert.deepEqual(plan.allocations, [
    { lotId: "early", points: 500 },
    { lotId: "late", points: 100 },
  ]);
  assert.equal(plan.totalPoints, 600);
});

test("planConsumption consumes fewer points than requested when lots run out", () => {
  const lots = [lot("early", 200, "2026-12-01T00:00:00Z"), lot("expired", 900, "2025-01-01T00:00:00Z")];
  const plan = planConsumption(lots, 1000, now());
  assert.deepEqual(plan.allocations, [{ lotId: "early", points: 200 }]);
  assert.equal(plan.totalPoints, 200);
});

test("planConsumption with nothing usable or zero points consumes nothing", () => {
  assert.deepEqual(planConsumption([lot("expired", 5, "2025-01-01T00:00:00Z")], 5, now()),
    { allocations: [], totalPoints: 0 });
  assert.deepEqual(planConsumption([lot("early", 5, "2026-12-01T00:00:00Z")], 0, now()),
    { allocations: [], totalPoints: 0 });
});

test("planRestoration returns allocations to their original lots", () => {
  const lots = [lot("early", 100, "2026-12-01T00:00:00Z"), lot("late", 200, "2026-12-31T00:00:00Z")];
  const plan = planRestoration(lots, [
    { lotId: "late", points: 150 },
    { lotId: "early", points: 50 },
  ], now());
  assert.deepEqual(plan.restorations, [{ lotId: "late", points: 150 }, { lotId: "early", points: 50 }]);
  assert.deepEqual(plan.forfeited, []);
});

test("planRestoration forfeits allocations whose lot expired by the reversal time", () => {
  const at = new Date("2026-12-15T00:00:00Z");
  const lots = [lot("early", 0, "2026-12-01T00:00:00Z"), lot("late", 200, "2026-12-31T00:00:00Z")];
  const plan = planRestoration(lots, [
    { lotId: "early", points: 500 },
    { lotId: "late", points: 150 },
  ], at);
  assert.deepEqual(plan.restorations, [{ lotId: "late", points: 150 }]);
  assert.deepEqual(plan.forfeited, [{ lotId: "early", points: 500 }]);
});

test("planRestoration forfeits allocations whose lot no longer exists", () => {
  const plan = planRestoration([], [{ lotId: "gone", points: 10 }], now());
  assert.deepEqual(plan.restorations, []);
  assert.deepEqual(plan.forfeited, [{ lotId: "gone", points: 10 }]);
});
