/**
 * Acceptance LOY-REDEEM-001
 * Given a pending order owned by the signed-in customer with points lots
 * When the customer sends POST /orders/:id/redeem with { points, idempotencyKey }
 * Then points are consumed from non-expired lots, earliest expiry first,
 *      applied after discount and before tax (100 points = 1 EUR, never below
 *      zero, excess points not consumed), and the new quote is returned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "../orders/helpers.ts";
import { seedLots } from "../../src/seed.ts";
import { planConsumption } from "../../src/loyalty/domain/redeem.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";
import type { Router } from "../../src/http/router.ts";

const redeem = (router: Router, id: string, body: unknown, headers = asAlice) =>
  router.handle({ method: "POST", path: `/orders/${id}/redeem`, headers, body });

const lot = (id: string, customerId: string, points: number, expiresAt: string): PointsLot =>
  ({ id, customerId, points, expiresAt: new Date(expiresAt) });

const balanceOf = async (loyalty: { lotsFor(c: string): Promise<PointsLot[]> }, customerId: string) =>
  Object.fromEntries((await loyalty.lotsFor(customerId)).map(l => [l.id, l.points]));

test("LOY-REDEEM-001: points apply after discount and before tax", async () => {
  const { router } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots);
  // subtotal 10000, SAVE10 discount 1000, 300 points = 300 cents,
  // tax 19% on 8700 = 1653, total 10353.
  const res = await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 10000, discountCents: 1000,
    pointsCents: 300, taxCents: 1653, totalCents: 10353,
  });
});

test("LOY-REDEEM-001: consumes non-expired lots, earliest expiry first", async () => {
  const { router, loyalty } = app([pendingOrder()], [
    lot("late", "alice", 400, "2027-06-30T00:00:00Z"),
    lot("soon", "alice", 100, "2026-12-01T00:00:00Z"),
    lot("spent-ago", "alice", 1000, "2025-01-01T00:00:00Z"), // expired at now
  ]);
  const res = await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 10000, discountCents: 0,
    pointsCents: 300, taxCents: 1843, totalCents: 11543,
  });
  assert.deepEqual(await balanceOf(loyalty, "alice"),
    { late: 200, soon: 0, "spent-ago": 1000 }); // expired lot untouched
});

test("LOY-REDEEM-001: a redemption may span several lots", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  const res = await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.equal((res.body as { pointsCents: number }).pointsCents, 600);
  // lot-a2 (500, expires 2026-12-01) first, then lot-a1 (300, expires 2026-12-31).
  assert.deepEqual(await balanceOf(loyalty, "alice"),
    { "lot-a1": 200, "lot-a2": 0, "lot-a3": 1000 });
});

test("LOY-REDEEM-001: excess points are not consumed, amount never below zero", async () => {
  const { router, loyalty } = app([pendingOrder()], [
    lot("rich", "alice", 100000, "2027-06-30T00:00:00Z"),
  ]);
  const res = await redeem(router, "o1", { points: 20000, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 10000, discountCents: 0,
    pointsCents: 10000, taxCents: 0, totalCents: 0,
  });
  assert.equal((await balanceOf(loyalty, "alice")).rich, 90000);
});

test("LOY-REDEEM-001: only available points are consumed", async () => {
  const { router, loyalty } = app([pendingOrder()], [
    lot("small", "alice", 500, "2027-06-30T00:00:00Z"),
  ]);
  const res = await redeem(router, "o1", { points: 5000, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 10000, discountCents: 0,
    pointsCents: 500, taxCents: 1805, totalCents: 11305,
  });
  assert.equal((await balanceOf(loyalty, "alice")).small, 0);
});

test("LOY-REDEEM-001: same idempotency key replays the same result, nothing more consumed", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  const first = await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  const replay = await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.deepEqual(await balanceOf(loyalty, "alice"),
    { "lot-a1": 300, "lot-a2": 200, "lot-a3": 1000 }); // consumed once only
});

test("LOY-REDEEM-001: same key with a different body is rejected", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.deepEqual(await balanceOf(loyalty, "alice"),
    { "lot-a1": 300, "lot-a2": 200, "lot-a3": 1000 }); // nothing additional consumed
});

test("LOY-REDEEM-001: several redemptions on one order accumulate in the quote", async () => {
  const { router, loyalty } = app([pendingOrder()], [
    lot("lots", "alice", 1000, "2027-06-30T00:00:00Z"),
  ]);
  await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  const second = await redeem(router, "o1", { points: 100, idempotencyKey: "k2" });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, {
    region: "DE", subtotalCents: 10000, discountCents: 0,
    pointsCents: 200, taxCents: 1862, totalCents: 11662,
  });
  assert.equal((await balanceOf(loyalty, "alice")).lots, 800);
});

test("LOY-REDEEM-001: only the owner of a pending order can redeem", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k" }, asBob)).status, 404);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k" }, {})).status, 401);
  assert.equal((await redeem(router, "oX", { points: 100, idempotencyKey: "k" })).status, 404);
  // None of the failed attempts consumed anything.
  assert.deepEqual(await balanceOf(loyalty, "alice"),
    { "lot-a1": 300, "lot-a2": 500, "lot-a3": 1000 });
  const ok = await redeem(router, "o1", { points: 100, idempotencyKey: "k" });
  assert.equal(ok.status, 200);
});

test("LOY-REDEEM-001: non-pending orders are rejected with 409", async () => {
  const { router, loyalty } = app([pendingOrder({ status: "shipped" })], seedLots);
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k" });
  assert.equal(res.status, 409);
  assert.deepEqual(await balanceOf(loyalty, "alice"),
    { "lot-a1": 300, "lot-a2": 500, "lot-a3": 1000 }); // untouched
});

test("LOY-REDEEM-001: invalid bodies are rejected with 400", async () => {
  const { router } = app([pendingOrder()], seedLots);
  for (const body of [undefined, {}, { points: 0, idempotencyKey: "k" }, { points: -5, idempotencyKey: "k" },
    { points: 1.5, idempotencyKey: "k" }, { points: "100", idempotencyKey: "k" },
    { points: 100 }, { points: 100, idempotencyKey: "" }, { points: 100, idempotencyKey: 42 }]) {
    const res = await redeem(router, "o1", body);
    assert.equal(res.status, 400, "expected 400 for body " + JSON.stringify(body));
  }
});

test("lot consumption plan takes the earliest-expiring usable lots first", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const lots = [
    lot("c", "alice", 100, "2027-03-01T00:00:00Z"),
    lot("a", "alice", 50, "2026-12-01T00:00:00Z"),
    lot("dead", "alice", 500, "2025-01-01T00:00:00Z"),
    lot("b", "alice", 50, "2026-12-01T00:00:00Z"), // ties keep insertion order
  ];
  const plan = planConsumption(lots, 150, now);
  assert.deepEqual(plan, [{ lotId: "a", points: 50 }, { lotId: "b", points: 50 }, { lotId: "c", points: 50 }]);
  assert.deepEqual(planConsumption(lots, 10000, now).reduce((s, p) => s + p.points, 0), 200);
});
