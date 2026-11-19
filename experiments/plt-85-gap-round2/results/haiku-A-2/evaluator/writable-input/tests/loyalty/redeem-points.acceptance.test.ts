/**
 * Acceptance LOY-002
 * Given a pending order owned by the signed-in customer
 * When the customer sends POST /orders/:id/redeem with { points, idempotencyKey }
 * Then points come from non-expired lots (earliest expiry first), reduce the amount after
 * discounts and before tax, never below zero, and are not consumed beyond what is applied.
 * Cancelling restores points to their original lots; expired lots forfeit them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "../orders/helpers.ts";
import { seedLots } from "../../src/seed.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";
import type { Order } from "../../src/orders/domain/order.ts";

// Alice's seeded order o1 (book 2x1999 + pen 3x350 = 5048, SAVE10 -> 505 off, 4543 payable).
const aliceO1 = (over: Partial<Order> = {}) => pendingOrder({ id: "o1", customerId: "alice", discountCode: "SAVE10",
  lines: [{ sku: "book", unitPriceCents: 1999, quantity: 2 }, { sku: "pen", unitPriceCents: 350, quantity: 3 }], ...over });
const aliceO2 = () => pendingOrder({ id: "o2", customerId: "alice", lines: [{ sku: "x", unitPriceCents: 1000, quantity: 1 }] });
const redeem = (router: ReturnType<typeof app>["router"], orderId: string, body: unknown, headers = asAlice) =>
  router.handle({ method: "POST", path: `/orders/${orderId}/redeem`, headers, body });

test("LOY-002: points come from earliest-expiring non-expired lots and reduce the amount before tax", async () => {
  const { router, loyalty } = app([aliceO1()], seedLots);
  const res = await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  // lot-a2 (500, expires 12-01) first, then lot-a1 (100 of 300); expired lot-a3 untouched.
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 5048, discountCents: 505, pointsAppliedCents: 600,
    taxCents: 749, totalCents: 4692 });
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 0);
  assert.equal((await loyalty.getLot("lot-a1"))!.points, 200);
  assert.equal((await loyalty.getLot("lot-a3"))!.points, 1000);
});

test("LOY-002: excess points are not consumed", async () => {
  const { router, loyalty } = app([aliceO1()], seedLots);
  const res = await redeem(router, "o1", { points: 10000, idempotencyKey: "k1" });
  // Only the 800 non-expired points are usable (4543 payable is not the limit here).
  assert.equal((res.body as { pointsAppliedCents: number }).pointsAppliedCents, 800);
  assert.equal((await loyalty.getLot("lot-a3"))!.points, 1000);
  assert.equal((res.body as { totalCents: number }).totalCents, 4454);
});

test("LOY-002: points never take the payable amount below zero", async () => {
  const { router, loyalty } = app([pendingOrder({ id: "o1", customerId: "alice", lines: [{ sku: "x", unitPriceCents: 500, quantity: 1 }] })],
    [{ id: "big", customerId: "alice", points: 1000, expiresAt: new Date("2027-01-01T00:00:00Z") }]);
  const res = await redeem(router, "o1", { points: 1000, idempotencyKey: "k1" });
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 500, discountCents: 0, pointsAppliedCents: 500, taxCents: 0, totalCents: 0 });
  assert.equal((await loyalty.getLot("big"))!.points, 500);
});

test("LOY-002: the same key and body replays the same result without consuming more", async () => {
  const { router, loyalty } = app([aliceO1()], seedLots);
  const first = await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  const second = await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal((await loyalty.getLot("lot-a1"))!.points, 200);
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 0);
});

test("LOY-002: the same key with a different body is rejected and consumes nothing", async () => {
  const { router, loyalty } = app([aliceO1()], seedLots);
  await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  const res = await redeem(router, "o1", { points: 700, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal((await loyalty.getLot("lot-a1"))!.points, 200);
});

test("LOY-002: concurrent redemptions for one customer never spend the same points", async () => {
  const lot: PointsLot = { id: "shared", customerId: "alice", points: 800, expiresAt: new Date("2027-01-01T00:00:00Z") };
  const { router, loyalty } = app([aliceO1(), aliceO2()], [lot]);
  const [a, b] = await Promise.all([
    redeem(router, "o1", { points: 800, idempotencyKey: "ka" }),
    redeem(router, "o2", { points: 800, idempotencyKey: "kb" }),
  ]);
  const applied = [a, b].map(r => (r.body as { pointsAppliedCents: number }).pointsAppliedCents);
  assert.equal(applied[0]! + applied[1]!, 800);
  assert.equal((await loyalty.getLot("shared"))!.points, 0);
});

test("LOY-002: cancelling returns points to their original lots with original expiry", async () => {
  let clock = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty } = app([aliceO1()], seedLots, () => clock);
  await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  clock = new Date("2026-11-20T12:00:00Z");
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 500);
  assert.equal((await loyalty.getLot("lot-a1"))!.points, 300);
  assert.equal((await loyalty.getLot("lot-a2"))!.expiresAt.toISOString(), "2026-12-01T00:00:00.000Z");
  assert.equal((await loyalty.getLot("lot-a1"))!.expiresAt.toISOString(), "2026-12-31T00:00:00.000Z");
});

test("LOY-002: points whose lot expired before cancelling are forfeited", async () => {
  let clock = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty } = app([aliceO1()], seedLots, () => clock);
  await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  clock = new Date("2026-12-15T12:00:00Z"); // lot-a2 (expired 12-01) is gone; lot-a1 still live
  await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 0);
  assert.equal((await loyalty.getLot("lot-a1"))!.points, 300);
});

test("LOY-002: only the owner's pending orders can be redeemed", async () => {
  const { router } = app([aliceO1(), pendingOrder({ id: "o9", customerId: "alice", status: "shipped" })], seedLots);
  assert.equal((await redeem(router, "o1", { points: 1, idempotencyKey: "k" }, asBob)).status, 404);
  assert.equal((await redeem(router, "o9", { points: 1, idempotencyKey: "k" })).status, 409);
  assert.equal((await redeem(router, "o1", { points: 1, idempotencyKey: "k" }, {})).status, 401);
});

test("LOY-002: invalid bodies are rejected", async () => {
  const { router } = app([aliceO1()], seedLots);
  assert.equal((await redeem(router, "o1", { points: 0, idempotencyKey: "k" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 1.5, idempotencyKey: "k" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 10 })).status, 400);
  assert.equal((await redeem(router, "o1", undefined)).status, 400);
});
