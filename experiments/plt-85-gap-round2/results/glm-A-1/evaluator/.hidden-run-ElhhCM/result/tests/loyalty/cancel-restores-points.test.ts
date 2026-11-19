/**
 * Acceptance LOY-REDEEM-003
 * Given a redeemed order
 * When the customer cancels it
 * Then the redeemed points return to their original lots with their original
 *      expiry, and points whose lot expired by then are forfeited.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, pendingOrder } from "../orders/helpers.ts";
import { seedLots } from "../../src/seed.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";
import type { Router } from "../../src/http/router.ts";

const redeem = (router: Router, id: string, body: unknown) =>
  router.handle({ method: "POST", path: `/orders/${id}/redeem`, headers: asAlice, body });

const balanceOf = async (loyalty: { lotsFor(c: string): Promise<PointsLot[]> }, customerId: string) =>
  Object.fromEntries((await loyalty.lotsFor(customerId)).map(l => [l.id, l.points]));

test("LOY-REDEEM-003: cancelling a redeemed order returns the points to their lots", async () => {
  let now = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty, orders } = app([pendingOrder()], seedLots, () => now);
  await redeem(router, "o1", { points: 300, idempotencyKey: "k1" }); // from lot-a2 (expires 2026-12-01)
  assert.deepEqual(await balanceOf(loyalty, "alice"),
    { "lot-a1": 300, "lot-a2": 200, "lot-a3": 1000 });

  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal(orders.get("o1")!.status, "cancelled");
  assert.deepEqual(await balanceOf(loyalty, "alice"),
    { "lot-a1": 300, "lot-a2": 500, "lot-a3": 1000 }); // back to the original lot
});

test("LOY-REDEEM-003: points of a lot that expired before cancellation are forfeited", async () => {
  let now = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty } = app([pendingOrder()], seedLots, () => now);
  await redeem(router, "o1", { points: 300, idempotencyKey: "k1" }); // from lot-a2 (expires 2026-12-01)
  now = new Date("2027-01-15T00:00:00Z"); // lot-a2 expired in the meantime

  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.deepEqual(await balanceOf(loyalty, "alice"),
    { "lot-a1": 300, "lot-a2": 200, "lot-a3": 1000 }); // the 300 points are gone
});

test("LOY-REDEEM-003: points split across lots return to each lot, expired ones forfeited", async () => {
  let now = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty } = app([pendingOrder()], [
    { id: "keep", customerId: "alice", points: 100, expiresAt: new Date("2027-06-30T00:00:00Z") },
    { id: "lose", customerId: "alice", points: 400, expiresAt: new Date("2026-12-01T00:00:00Z") },
  ], () => now);
  await redeem(router, "o1", { points: 300, idempotencyKey: "k1" }); // earliest expiry first: all 300 from "lose" (400 -> 100)
  assert.deepEqual(await balanceOf(loyalty, "alice"), { keep: 100, lose: 100 });

  now = new Date("2027-01-15T00:00:00Z"); // "lose" expired, "keep" still valid
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.deepEqual(await balanceOf(loyalty, "alice"), { keep: 100, lose: 100 }); // forfeited
});

test("LOY-REDEEM-003: cancelling twice restores points only once", async () => {
  let now = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty } = app([pendingOrder()], seedLots, () => now);
  await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  const second = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(second.status, 409); // no longer pending
  assert.deepEqual(await balanceOf(loyalty, "alice"),
    { "lot-a1": 300, "lot-a2": 500, "lot-a3": 1000 });
});

test("LOY-REDEEM-003: cancelling an order without redemptions still works", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.deepEqual(await balanceOf(loyalty, "alice"),
    { "lot-a1": 300, "lot-a2": 500, "lot-a3": 1000 });
});
