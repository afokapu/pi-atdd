/**
 * Acceptance LOY-REDEEM-002
 * Given concurrent redemptions for one customer
 * When several POST /orders/:id/redeem requests race
 * Then the asynchronous ledger never lets them spend the same points:
 *      no lot goes negative and the applied points sum to what was available.
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

test("LOY-REDEEM-002: two concurrent redemptions never spend the same points", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots); // 800 usable points for alice
  const [r1, r2] = await Promise.all([
    redeem(router, "o1", { points: 500, idempotencyKey: "k1" }),
    redeem(router, "o1", { points: 500, idempotencyKey: "k2" }),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  // Each quote shows the points applied to the order so far; the increments
  // (500, then 300) sum to exactly the 800 points that were available.
  assert.equal((r1.body as { pointsCents: number }).pointsCents, 500);
  assert.equal((r2.body as { pointsCents: number }).pointsCents, 800);
  const balance = await balanceOf(loyalty, "alice");
  assert.deepEqual(balance, { "lot-a1": 0, "lot-a2": 0, "lot-a3": 1000 }); // a3 is expired, untouched
  assert.ok(Object.values(balance).every(p => p >= 0));
});

test("LOY-REDEEM-002: three concurrent redemptions split the available points", async () => {
  const { router, loyalty } = app([pendingOrder()], [
    { id: "only", customerId: "alice", points: 800, expiresAt: new Date("2027-06-30T00:00:00Z") },
  ]);
  const [r1, r2, r3] = await Promise.all([
    redeem(router, "o1", { points: 300, idempotencyKey: "k1" }),
    redeem(router, "o1", { points: 300, idempotencyKey: "k2" }),
    redeem(router, "o1", { points: 300, idempotencyKey: "k3" }),
  ]);
  // Cumulative quotes: 300, 600, then 800 — the last redemption is capped by
  // what is left in the lot, and the lot is spent exactly once.
  assert.deepEqual([r1, r2, r3].map(r => (r.body as { pointsCents: number }).pointsCents), [300, 600, 800]);
  assert.equal((await balanceOf(loyalty, "alice")).only, 0);
});

test("LOY-REDEEM-002: the same key sent twice concurrently is consumed once", async () => {
  const { router, loyalty } = app([pendingOrder()], [
    { id: "only", customerId: "alice", points: 800, expiresAt: new Date("2027-06-30T00:00:00Z") },
  ]);
  const responses = await Promise.all([
    redeem(router, "o1", { points: 300, idempotencyKey: "k1" }),
    redeem(router, "o1", { points: 300, idempotencyKey: "k1" }),
  ]);
  assert.deepEqual(responses[0]!.body, responses[1]!.body);
  assert.equal((responses[0]!.body as { pointsCents: number }).pointsCents, 300);
  assert.equal((await balanceOf(loyalty, "alice")).only, 500);
});
