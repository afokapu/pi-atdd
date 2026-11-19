/**
 * Acceptance LOY-CANCEL-002
 * Given a redeemed pending order
 * When the customer cancels it
 * Then the points return to their original lots with their original expiry,
 *      points whose lot has expired by then are forfeited, and repeated
 *      cancellation never restores points twice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "../orders/helpers.ts";
import type { Router } from "../../src/http/router.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const aliceLots = (): PointsLot[] => [
  { id: "l1", customerId: "alice", points: 500, expiresAt: new Date("2026-12-01T00:00:00Z") },
  { id: "l2", customerId: "alice", points: 300, expiresAt: new Date("2027-01-31T00:00:00Z") },
];

const redeem = (router: Router, body: unknown) =>
  router.handle({ method: "POST", path: "/orders/o1/redeem", headers: asAlice, body });
const cancel = (router: Router, headers = asAlice) =>
  router.handle({ method: "POST", path: "/orders/o1/cancel", headers });

test("LOY-CANCEL-002: cancelling a redeemed order restores points to their original lots", async () => {
  const { router, orders, loyalty } = app([pendingOrder()], aliceLots());
  await redeem(router, { points: 600, idempotencyKey: "k1" }); // l1 -> 0, l2 -> 200
  assert.equal((await loyalty.getLot("l1"))!.points, 0);
  const res = await cancel(router);
  assert.equal(res.status, 200);
  assert.equal(orders.get("o1")!.status, "cancelled");
  // Same lot ids, same expiry, full amounts back — no new lots were created.
  assert.deepEqual(await loyalty.getLot("l1"), { id: "l1", customerId: "alice", points: 500, expiresAt: new Date("2026-12-01T00:00:00Z") });
  assert.deepEqual(await loyalty.getLot("l2"), { id: "l2", customerId: "alice", points: 300, expiresAt: new Date("2027-01-31T00:00:00Z") });
});

test("LOY-CANCEL-002: points in lots that expired before cancellation are forfeited", async () => {
  let now = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty } = app([pendingOrder()], aliceLots(), () => now);
  await redeem(router, { points: 600, idempotencyKey: "k1" }); // draws l1 500 + l2 100
  now = new Date("2026-12-15T00:00:00Z"); // l1 (expires 2026-12-01) has since expired
  const res = await cancel(router);
  assert.equal(res.status, 200);
  assert.equal((await loyalty.getLot("l1"))!.points, 0); // forfeited, not restored
  assert.equal((await loyalty.getLot("l2"))!.points, 300); // restored in full
});

test("LOY-CANCEL-002: cancelling twice does not restore points twice", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  await redeem(router, { points: 600, idempotencyKey: "k1" });
  assert.equal((await cancel(router)).status, 200);
  assert.equal((await cancel(router)).status, 409); // no longer pending
  assert.equal((await loyalty.getLot("l1"))!.points, 500);
  assert.equal((await loyalty.getLot("l2"))!.points, 300);
});

test("LOY-CANCEL-002: another customer cannot cancel (or restore) someone's points", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  await redeem(router, { points: 400, idempotencyKey: "k1" });
  assert.equal((await cancel(router, asBob)).status, 404);
  assert.equal((await loyalty.getLot("l1"))!.points, 100); // untouched
});

test("LOY-CANCEL-002: replaying a redeemed key after cancellation returns the stored result", async () => {
  const { router } = app([pendingOrder()], aliceLots());
  const first = await redeem(router, { points: 400, idempotencyKey: "k1" });
  await cancel(router);
  const replay = await redeem(router, { points: 400, idempotencyKey: "k1" });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body); // verbatim replay, nothing re-consumed
});
