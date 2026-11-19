/**
 * Acceptance LOY-002
 * Given a pending order owned by the signed-in customer
 * When the customer sends POST /orders/:id/redeem with { points, idempotencyKey }
 * Then points are taken from non-expired lots (earliest expiry first) after the discount and before tax,
 * never below zero, repeating the key changes nothing, concurrent redemptions never double-spend,
 * and cancelling the order returns the points to their original lots unless those lots have expired.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "./helpers.ts";
import { seedLots } from "../../src/seed.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";
import type { Router } from "../../src/http/router.ts";
import type { InMemoryLoyaltyStore } from "../../src/loyalty/integration/loyalty-store.ts";

const redeem = (router: Router, orderId: string, body: unknown, headers = asAlice) =>
  router.handle({ method: "POST", path: `/orders/${orderId}/redeem`, headers, body });
const cancel = (router: Router, orderId: string, headers = asAlice) =>
  router.handle({ method: "POST", path: `/orders/${orderId}/cancel`, headers });
const lot = async (loyalty: InMemoryLoyaltyStore, id: string): Promise<PointsLot> => (await loyalty.getLot(id))!;

// Alice's seed lots at 2026-11-19: lot-a2 500 (exp 2026-12-01), lot-a1 300 (exp 2026-12-31), lot-a3 1000 (expired 2025).
// pendingOrder({ discountCode: "SAVE10" }) subtotal 10000 -> discount 1000 -> 9000 before points and tax.
const NOW = "2026-11-19T12:00:00Z";

test("LOY-002: points reduce the discounted amount before tax", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots);
  const res = await redeem(router, "o1", { points: 800, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 10000, discountCents: 1000, pointsAppliedCents: 800, taxCents: 1558, totalCents: 9758,
  });
  assert.equal((await lot(loyalty, "lot-a2")).points, 0);
  assert.equal((await lot(loyalty, "lot-a1")).points, 0);
  assert.equal((await lot(loyalty, "lot-a3")).points, 1000, "expired lot is never consumed");
});

test("LOY-002: earliest-expiring lots are consumed first, and only the needed amount", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots);
  const res = await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.equal((res.body as { pointsAppliedCents: number }).pointsAppliedCents, 600);
  assert.equal((await lot(loyalty, "lot-a2")).points, 0);
  assert.equal((await lot(loyalty, "lot-a1")).points, 200);
});

test("LOY-002: points beyond the payable amount are not consumed", async () => {
  const big: PointsLot[] = [{ id: "big", customerId: "alice", points: 5000, expiresAt: new Date("2027-01-01T00:00:00Z") }];
  const { router, loyalty } = app([pendingOrder({ lines: [{ sku: "x", unitPriceCents: 1000, quantity: 1 }] })], big);
  const res = await redeem(router, "o1", { points: 5000, idempotencyKey: "k1" });
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 1000, discountCents: 0, pointsAppliedCents: 1000, taxCents: 0, totalCents: 0 });
  assert.equal((await lot(loyalty, "big")).points, 4000);
});

test("LOY-002: points never take the amount below zero", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "FLAT5", lines: [{ sku: "x", unitPriceCents: 300, quantity: 1 }] })], seedLots);
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 300, discountCents: 300, pointsAppliedCents: 0, taxCents: 0, totalCents: 0 });
  assert.equal((await lot(loyalty, "lot-a2")).points, 500, "nothing consumed when the amount is zero");
});

test("LOY-002: repeating a key returns the same result and spends nothing more", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots);
  const first = await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  const second = await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal((await lot(loyalty, "lot-a1")).points, 200, "consumed once, not twice");
});

test("LOY-002: same key with a different body is rejected and spends nothing", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots);
  assert.equal((await redeem(router, "o1", { points: 600, idempotencyKey: "k1" })).status, 200);
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal((await lot(loyalty, "lot-a1")).points, 200);
});

test("LOY-002: concurrent redemptions with the same key spend once", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots);
  const [a, b] = await Promise.all([
    redeem(router, "o1", { points: 600, idempotencyKey: "k1" }),
    redeem(router, "o1", { points: 600, idempotencyKey: "k1" }),
  ]);
  assert.equal(a.status, 200);
  assert.deepEqual(b.body, a.body);
  assert.equal((await lot(loyalty, "lot-a1")).points, 200);
});

test("LOY-002: concurrent redemptions for one customer never spend the same points", async () => {
  // Alice holds 800 spendable points; two orders each try to spend all of them at once.
  const { router, loyalty } = app([pendingOrder(), pendingOrder({ id: "o4" })], seedLots);
  const [a, b] = await Promise.all([
    redeem(router, "o1", { points: 800, idempotencyKey: "k1" }),
    redeem(router, "o4", { points: 800, idempotencyKey: "k2" }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal((await lot(loyalty, "lot-a1")).points, 0);
  assert.equal((await lot(loyalty, "lot-a2")).points, 0);
});

test("LOY-002: cancelling a redeemed order returns points to their original lots and expiry", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots);
  assert.equal((await redeem(router, "o1", { points: 600, idempotencyKey: "k1" })).status, 200);
  assert.equal((await cancel(router, "o1")).status, 200);
  const a2 = await lot(loyalty, "lot-a2");
  const a1 = await lot(loyalty, "lot-a1");
  assert.equal(a2.points, 500);
  assert.equal(a2.expiresAt.toISOString(), "2026-12-01T00:00:00.000Z");
  assert.equal(a1.points, 300);
  assert.equal(a1.expiresAt.toISOString(), "2026-12-31T00:00:00.000Z");
});

test("LOY-002: points whose lot expired before cancellation are forfeited", async () => {
  let clock = new Date(NOW);
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots, () => clock);
  assert.equal((await redeem(router, "o1", { points: 600, idempotencyKey: "k1" })).status, 200);
  clock = new Date("2026-12-05T00:00:00Z"); // lot-a2 (exp 12-01) has expired; lot-a1 (exp 12-31) has not
  assert.equal((await cancel(router, "o1")).status, 200);
  assert.equal((await lot(loyalty, "lot-a2")).points, 0, "expired lot stays empty");
  assert.equal((await lot(loyalty, "lot-a1")).points, 300, "unexpired lot gets its points back");
});

test("LOY-002: expired lots cannot be spent later", async () => {
  let clock = new Date("2026-12-05T00:00:00Z");
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots, () => clock);
  const res = await redeem(router, "o1", { points: 400, idempotencyKey: "k1" });
  assert.equal(res.status, 409, "only 300 points (lot-a1) are spendable on 2026-12-05");
  assert.equal((await lot(loyalty, "lot-a1")).points, 300);
});

test("LOY-002: an order can be paid with points only once", async () => {
  const { router } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k1" })).status, 200);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k2" })).status, 409);
});

test("LOY-002: a cancelled order cannot be redeemed", async () => {
  const { router } = app([pendingOrder()], seedLots);
  assert.equal((await cancel(router, "o1")).status, 200);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k1" })).status, 409);
});

test("LOY-002: shipped orders cannot be redeemed", async () => {
  const { router, loyalty } = app([pendingOrder({ status: "shipped" })], seedLots);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k1" })).status, 409);
  assert.equal((await lot(loyalty, "lot-a2")).points, 500);
});

test("LOY-002: another customer's order is not found", async () => {
  const { router } = app([pendingOrder()], seedLots);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k1" }, asBob)).status, 404);
});

test("LOY-002: requesting more points than the customer holds is rejected", async () => {
  const { router, loyalty } = app([pendingOrder({ id: "o3", customerId: "bob", region: "FR" })], seedLots);
  assert.equal((await redeem(router, "o3", { points: 300, idempotencyKey: "k1" }, asBob)).status, 409);
  assert.equal((await lot(loyalty, "lot-b1")).points, 250);
});

test("LOY-002: unauthenticated requests are rejected", async () => {
  const { router } = app([pendingOrder()], seedLots);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k1" }, {})).status, 401);
});

test("LOY-002: invalid bodies are rejected", async () => {
  const { router } = app([pendingOrder()], seedLots);
  assert.equal((await redeem(router, "o1", { points: 0, idempotencyKey: "k1" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 1.5, idempotencyKey: "k1" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: "100", idempotencyKey: "k1" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 100 })).status, 400);
  assert.equal((await redeem(router, "o1", undefined)).status, 400);
});
