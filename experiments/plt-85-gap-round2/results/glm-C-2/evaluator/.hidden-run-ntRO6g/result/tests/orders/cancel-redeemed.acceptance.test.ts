/**
 * Acceptance LOY-REDEEM-002
 * Cancelling an order that was paid partly with points returns the points to
 * their original lots with their original expiry; points whose lot expired by
 * reversal time are forfeited. The reversal applies exactly once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, pendingOrder } from "./helpers.ts";
import { seedLots } from "../../src/seed.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const redeem = (router: ReturnType<typeof app>["router"], key: string, points: number) =>
  router.handle({ method: "POST", path: "/orders/o1/redeem", headers: asAlice, body: { points, idempotencyKey: key } });

const cancel = (router: ReturnType<typeof app>["router"]) =>
  router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });

const lotById = async (loyalty: ReturnType<typeof app>["loyalty"], customerId: string) =>
  new Map((await loyalty.lotsFor(customerId)).map(l => [l.id, l]));

test("cancelling a redeemed order restores points to their original lot with original expiry", async () => {
  const { router, loyalty, orders } = app([pendingOrder()], seedLots);
  assert.equal((await redeem(router, "key-1", 300)).status, 200); // drawn from lot-a2
  const res = await cancel(router);
  assert.equal(res.status, 200);
  assert.equal(orders.get("o1")!.status, "cancelled");
  const lots = await lotById(loyalty, "alice");
  const a2 = lots.get("lot-a2")!;
  assert.equal(a2.points, 500); // exactly the drawn amount, back where it came from
  assert.equal(a2.expiresAt.getTime(), new Date("2026-12-01T00:00:00Z").getTime()); // original expiry kept
  assert.equal(lots.get("lot-a1")!.points, 300); // untouched lots stay untouched
});

test("points whose lot expired before the cancel are forfeited; the rest are restored", async () => {
  const lots: PointsLot[] = [
    { id: "l1", customerId: "alice", points: 200, expiresAt: new Date("2026-12-31T00:00:00Z") },
    { id: "l2", customerId: "alice", points: 400, expiresAt: new Date("2027-06-30T00:00:00Z") },
  ];
  let clock = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty } = app([pendingOrder()], lots, () => clock);
  // Redeem 500 at 2026-11-19: draws l1 200 + l2 300, earliest expiry first.
  assert.equal((await redeem(router, "key-1", 500)).status, 200);
  // Cancel after l1's expiry has passed.
  clock = new Date("2027-01-15T12:00:00Z");
  assert.equal((await cancel(router)).status, 200);
  const restored = await lotById(loyalty, "alice");
  assert.equal(restored.get("l1")!.points, 0); // expired lot: 200 points forfeited
  assert.equal(restored.get("l2")!.points, 400); // 400 − 300 drawn + 300 restored, same lot, same expiry
});

test("a redeemed order is reversed exactly once, even when two cancels race", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  assert.equal((await redeem(router, "key-1", 300)).status, 200);
  const [c1, c2] = await Promise.all([cancel(router), cancel(router)]);
  assert.deepEqual([c1.status, c2.status].sort(), [200, 409]); // one cancel wins
  assert.equal((await lotById(loyalty, "alice")).get("lot-a2")!.points, 500); // restored once, not twice
});

test("several redemptions on one order are all reversed on cancel", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  assert.equal((await redeem(router, "k1", 100)).status, 200);
  assert.equal((await redeem(router, "k2", 200)).status, 200);
  assert.equal((await cancel(router)).status, 200);
  assert.equal((await lotById(loyalty, "alice")).get("lot-a2")!.points, 500); // 100 + 200 fully restored
});

test("cancelling an order that was never redeemed leaves the lots untouched", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  assert.equal((await cancel(router)).status, 200);
  const lots = await lotById(loyalty, "alice");
  assert.equal(lots.get("lot-a1")!.points, 300);
  assert.equal(lots.get("lot-a2")!.points, 500);
});
