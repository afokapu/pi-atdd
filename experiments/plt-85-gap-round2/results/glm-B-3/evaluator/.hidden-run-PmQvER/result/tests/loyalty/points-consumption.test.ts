/**
 * Loyalty domain rules for LOY-002: consumption planning (usable lots, earliest
 * expiry first, stable tie-break, availability cap) and refund splitting
 * (expired or vanished lots forfeit their points).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planConsumption, refundableConsumption, type PointsLot } from "../../src/loyalty/domain/points.ts";

const lot = (id: string, points: number, iso: string): PointsLot =>
  ({ id, customerId: "alice", points, expiresAt: new Date(iso) });
const at = () => new Date("2026-11-19T12:00:00Z");

test("planConsumption skips expired and empty lots, earliest expiry first", () => {
  const lots = [
    lot("keep", 500, "2027-06-30T00:00:00Z"),
    lot("empty", 0, "2026-12-01T00:00:00Z"),
    lot("late", 300, "2026-12-31T00:00:00Z"),
    lot("dead", 300, "2025-06-30T00:00:00Z"),
    lot("early", 200, "2026-12-01T00:00:00Z"),
  ];
  const { plan, consumedPoints } = planConsumption(lots, 400, at());
  assert.deepEqual(plan, [{ lotId: "early", points: 200 }, { lotId: "late", points: 200 }]);
  assert.equal(consumedPoints, 400);
});

test("planConsumption breaks expiry ties by stored order and caps at availability", () => {
  const lots = [lot("b", 100, "2026-12-01T00:00:00Z"), lot("a", 100, "2026-12-01T00:00:00Z")];
  assert.deepEqual(planConsumption(lots, 150, at()).plan, [{ lotId: "b", points: 100 }, { lotId: "a", points: 50 }]);
  assert.deepEqual(planConsumption(lots, 0, at()), { plan: [], consumedPoints: 0 });
  assert.deepEqual(planConsumption([], 10, at()), { plan: [], consumedPoints: 0 });
});

test("refundableConsumption refunds unexpired lots and forfeits the rest", () => {
  const lots = new Map([
    [lot("alive", 0, "2027-06-30T00:00:00Z").id, lot("alive", 0, "2027-06-30T00:00:00Z")],
    [lot("dead", 0, "2026-01-01T00:00:00Z").id, lot("dead", 0, "2026-01-01T00:00:00Z")],
  ]);
  const consumed = [{ lotId: "alive", points: 200 }, { lotId: "dead", points: 300 }, { lotId: "gone", points: 50 }];
  const { refunds, forfeitedPoints } = refundableConsumption(consumed, lots, at());
  assert.deepEqual(refunds, [{ lotId: "alive", points: 200 }]);
  assert.equal(forfeitedPoints, 350);
});
