/** Unit tests for the loyalty consumption-planning rules (LOY-002). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { usableLots, planRedemption, pointsToCents, centsToPoints } from "../../src/loyalty/domain/points.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const lot = (id: string, points: number, iso: string): PointsLot => ({ id, customerId: "c", points, expiresAt: new Date(iso) });
const at = new Date("2026-06-15T00:00:00Z");

test("usableLots keeps only non-empty, non-expired lots, earliest expiry first", () => {
  const lots = [lot("late", 10, "2027-01-01Z"), lot("empty", 0, "2026-07-01Z"), lot("early", 10, "2026-07-01Z"), lot("expired", 99, "2026-06-15Z")];
  assert.deepEqual(usableLots(lots, at).map(l => l.id), ["early", "late"]);
});

test("planRedemption consumes earliest-expiry lots first and stops at the balance", () => {
  const plan = planRedemption([lot("b", 100, "2027-01-01Z"), lot("a", 300, "2026-09-01Z")], 400, at);
  assert.equal(plan.points, 400);
  assert.deepEqual(plan.taken.map(t => t.lotId), ["a", "b"]);
  assert.deepEqual(plan.taken.map(t => t.points), [300, 100]);
});

test("planRedemption is capped by the available balance", () => {
  const plan = planRedemption([lot("a", 300, "2026-09-01Z")], 10000, at);
  assert.equal(plan.points, 300);
  assert.deepEqual(plan.taken, [{ lotId: "a", points: 300, expiresAt: new Date("2026-09-01T00:00:00Z") }]);
});

test("planRedemption never touches expired lots", () => {
  const plan = planRedemption([lot("x", 500, "2026-01-01Z")], 100, at);
  assert.equal(plan.points, 0);
  assert.deepEqual(plan.taken, []);
});

test("100 points = 1 EUR: conversion helpers", () => {
  assert.equal(pointsToCents(100), 100);
  assert.equal(pointsToCents(1), 1);
  assert.equal(centsToPoints(4543), 4543);
  assert.equal(centsToPoints(0), 0);
});
