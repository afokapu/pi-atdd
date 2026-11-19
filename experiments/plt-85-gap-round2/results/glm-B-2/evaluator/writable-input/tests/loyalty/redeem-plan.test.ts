/**
 * LOY-REDEEM-001 domain rules: spend planning consumes non-expired lots
 * earliest-expiry-first (never below zero, excess not consumed), and refund
 * planning restores points to their original lots while forfeiting points
 * whose lot has expired.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRefund, planSpend } from "../../src/loyalty/domain/redeem.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const NOW = new Date("2026-11-19T12:00:00Z");
const lot = (id: string, points: number, iso: string): PointsLot =>
  ({ id, customerId: "c", points, expiresAt: new Date(iso) });

test("planSpend consumes earliest-expiring lots first", () => {
  const plan = planSpend([lot("late", 300, "2027-06-01T00:00:00Z"), lot("early", 300, "2026-12-01T00:00:00Z")], 400, NOW);
  assert.deepEqual(plan.deductions, [{ lotId: "early", points: 300 }, { lotId: "late", points: 100 }]);
  assert.equal(plan.applied, 400);
  assert.equal(plan.available, 600);
});

test("planSpend ignores expired and empty lots and caps at the balance", () => {
  const plan = planSpend(
    [lot("gone", 500, "2025-06-30T00:00:00Z"), lot("empty", 0, "2027-01-01T00:00:00Z"), lot("live", 100, "2027-01-01T00:00:00Z")],
    300,
    NOW,
  );
  assert.deepEqual(plan.deductions, [{ lotId: "live", points: 100 }]);
  assert.equal(plan.applied, 100);
  assert.equal(plan.available, 100);
});

test("planSpend consumes nothing beyond the requested amount", () => {
  const plan = planSpend([lot("only", 500, "2027-01-01T00:00:00Z")], 200, NOW);
  assert.deepEqual(plan.deductions, [{ lotId: "only", points: 200 }]);
  assert.equal(plan.applied, 200);
});

test("planRefund restores valid lots and forfeits expired ones", () => {
  const lots = [lot("early", 0, "2026-03-01T00:00:00Z"), lot("late", 400, "2027-01-01T00:00:00Z")];
  const at = new Date("2026-06-01T00:00:00Z"); // "early" has expired by now
  const plan = planRefund(
    [{ lotId: "early", points: 200 }, { lotId: "late", points: 100 }],
    id => lots.find(l => l.id === id),
    at,
  );
  assert.deepEqual(plan.restorations, [{ lotId: "late", points: 100 }]);
  assert.equal(plan.forfeited, 200);
});
