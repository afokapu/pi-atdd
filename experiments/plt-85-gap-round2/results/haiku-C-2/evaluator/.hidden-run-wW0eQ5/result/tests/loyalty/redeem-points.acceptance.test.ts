/**
 * Acceptance LOY-002
 * Given a pending order owned by the signed-in customer and points held in lots
 * When the customer sends POST /orders/:id/redeem with { points, idempotencyKey }
 * Then points are taken from usable lots (earliest expiry first), applied after discount and
 *      before tax, replays are idempotent, concurrent redemptions never double-spend, and
 *      cancelling the order restores the points to their original lots.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, pendingOrder } from "../orders/helpers.ts";
import { seedLots } from "../../src/seed.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";
import type { InMemoryLoyaltyStore } from "../../src/loyalty/integration/loyalty-store.ts";
import type { Router } from "../../src/http/router.ts";

const BOOK_AND_PEN = [{ sku: "book", unitPriceCents: 1999, quantity: 2 }, { sku: "pen", unitPriceCents: 350, quantity: 3 }];

const redeem = (router: Router, orderId: string, body: unknown, headers = asAlice) =>
  router.handle({ method: "POST", path: `/orders/${orderId}/redeem`, headers, body });
const cancel = (router: Router, orderId: string) =>
  router.handle({ method: "POST", path: `/orders/${orderId}/cancel`, headers: asAlice });
const pointsOf = async (loyalty: InMemoryLoyaltyStore, lotId: string) => (await loyalty.getLot(lotId))!.points;

/** A mutable clock so a test can move past a lot's expiry between steps. */
function clock(start: string) {
  let now = new Date(start);
  return { now: () => now, set: (iso: string) => { now = new Date(iso); } };
}

test("LOY-002: points apply after discount, before tax, earliest expiry first, expired lots untouched", async () => {
  const { router, loyalty } = app([pendingOrder({ lines: BOOK_AND_PEN, discountCode: "SAVE10" })], seedLots);
  const res = await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  // subtotal 5048; SAVE10 -> 505; 4543 after discount; 600 points; tax 19% of 3943 = 749; total 4692
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 5048, discountCents: 505, pointsAppliedCents: 600, taxCents: 749, totalCents: 4692,
  });
  assert.equal(await pointsOf(loyalty, "lot-a2"), 0);   // expires 2026-12-01: drawn first
  assert.equal(await pointsOf(loyalty, "lot-a1"), 200); // expires 2026-12-31: drawn for the rest
  assert.equal(await pointsOf(loyalty, "lot-a3"), 1000); // expired 2025: never drawn
});

test("LOY-002: excess points are not consumed and the amount never goes below zero", async () => {
  const lots: PointsLot[] = [{ id: "lot-x", customerId: "alice", points: 1000, expiresAt: new Date("2027-01-01T00:00:00Z") }];
  const { router, loyalty } = app([pendingOrder({ lines: [{ sku: "pen", unitPriceCents: 300, quantity: 1 }] })], lots);
  const res = await redeem(router, "o1", { points: 1000, idempotencyKey: "k1" });
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 300, discountCents: 0, pointsAppliedCents: 300, taxCents: 0, totalCents: 0 });
  assert.equal(await pointsOf(loyalty, "lot-x"), 700);
});

test("LOY-002: same key and body replays the stored result without consuming again", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  const first = await redeem(router, "o1", { points: 200, idempotencyKey: "k1" });
  const after = await pointsOf(loyalty, "lot-a2");
  const replay = await redeem(router, "o1", { points: 200, idempotencyKey: "k1" });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(await pointsOf(loyalty, "lot-a2"), after);
});

test("LOY-002: same key with a different body is rejected and changes nothing", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  await redeem(router, "o1", { points: 200, idempotencyKey: "k1" });
  const before = await pointsOf(loyalty, "lot-a2");
  const res = await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal(await pointsOf(loyalty, "lot-a2"), before);
});

test("LOY-002: a second redemption with a new key on the same order is rejected", async () => {
  const { router } = app([pendingOrder()], seedLots);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k1" })).status, 200);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k2" })).status, 409);
});

test("LOY-002: concurrent redemptions for one customer never spend the same points", async () => {
  const lots: PointsLot[] = [{ id: "lot-x", customerId: "alice", points: 300, expiresAt: new Date("2027-01-01T00:00:00Z") }];
  const { router, loyalty } = app([pendingOrder({ id: "o1" }), pendingOrder({ id: "o2" })], lots);
  const [a, b] = await Promise.all([
    redeem(router, "o1", { points: 300, idempotencyKey: "ka" }),
    redeem(router, "o2", { points: 300, idempotencyKey: "kb" }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(await pointsOf(loyalty, "lot-x"), 0);
});

test("LOY-002: insufficient usable points is rejected and nothing is consumed", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots); // usable: 300 + 500 = 800
  const res = await redeem(router, "o1", { points: 900, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal(await pointsOf(loyalty, "lot-a2"), 500);
  assert.equal(await pointsOf(loyalty, "lot-a1"), 300);
});

test("LOY-002: cancelling a redeemed order restores points to their original lots and expiry", async () => {
  const time = clock("2026-11-19T12:00:00Z");
  const { router, loyalty } = app([pendingOrder({ lines: BOOK_AND_PEN })], seedLots, time.now);
  await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  const res = await cancel(router, "o1");
  assert.equal(res.status, 200);
  assert.equal(await pointsOf(loyalty, "lot-a2"), 500);
  assert.equal(await pointsOf(loyalty, "lot-a1"), 300);
  assert.equal((await loyalty.getLot("lot-a2"))!.expiresAt.toISOString(), "2026-12-01T00:00:00.000Z");
});

test("LOY-002: points whose lot expired before the cancellation are forfeited", async () => {
  const time = clock("2026-11-19T12:00:00Z");
  const { router, loyalty } = app([pendingOrder({ lines: BOOK_AND_PEN })], seedLots, time.now);
  await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  time.set("2026-12-05T00:00:00Z"); // lot-a2 (expires 2026-12-01) has expired; lot-a1 has not
  assert.equal((await cancel(router, "o1")).status, 200);
  assert.equal(await pointsOf(loyalty, "lot-a2"), 0);   // forfeited
  assert.equal(await pointsOf(loyalty, "lot-a1"), 300); // 200 + 100 restored
});

test("LOY-002: a cancelled redemption is restored once, even if cancel is repeated", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  await redeem(router, "o1", { points: 200, idempotencyKey: "k1" });
  assert.equal((await cancel(router, "o1")).status, 200);
  assert.equal((await cancel(router, "o1")).status, 409);
  assert.equal(await pointsOf(loyalty, "lot-a2"), 500);
});

test("LOY-002: a shipped order cannot be redeemed", async () => {
  const { router, loyalty } = app([pendingOrder({ status: "shipped" })], seedLots);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k1" })).status, 409);
  assert.equal(await pointsOf(loyalty, "lot-a2"), 500);
});

test("LOY-002: invalid body is rejected", async () => {
  const { router } = app([pendingOrder()], seedLots);
  assert.equal((await redeem(router, "o1", { points: 0, idempotencyKey: "k1" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 1.5, idempotencyKey: "k1" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 10 })).status, 400);
  assert.equal((await redeem(router, "o1", undefined)).status, 400);
});

test("LOY-002: another customer's order cannot be redeemed", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" }, { authorization: "Bearer tok-bob" });
  assert.equal(res.status, 404);
  assert.equal(await pointsOf(loyalty, "lot-a2"), 500);
});
