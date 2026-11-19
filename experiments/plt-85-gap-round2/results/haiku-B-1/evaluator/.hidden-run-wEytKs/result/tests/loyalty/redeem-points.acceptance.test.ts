/**
 * Acceptance LOY-002
 * A signed-in owner pays part of a pending order with points. Points come from
 * non-expired lots, earliest expiry first; they reduce the amount after discount and
 * before tax, never below zero. Repeats of an idempotency key are safe, concurrent
 * redemptions never spend the same points, and cancelling returns points to their lots.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "../orders/helpers.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const lot = (id: string, points: number, expiresAt: string, customerId = "alice"): PointsLot =>
  ({ id, customerId, points, expiresAt: new Date(expiresAt) });
const redeem = (router: ReturnType<typeof app>["router"], orderId: string, body: unknown, headers = asAlice) =>
  router.handle({ method: "POST", path: `/orders/${orderId}/redeem`, headers, body });

test("LOY-002: points reduce the amount after discount and before tax", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], [lot("l1", 1000, "2026-12-31T00:00:00Z")]);
  const res = await redeem(router, "o1", { points: 500, idempotencyKey: "k1" });
  // 10000 - 1000 (SAVE10) - 500 (points) = 8500 taxable, 19% tax = 1615
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 1000, pointsAppliedCents: 500, taxCents: 1615, totalCents: 10115 });
  assert.equal((await loyalty.getLot("l1"))!.points, 500);
});

test("LOY-002: lots are consumed earliest expiry first and expired lots are skipped", async () => {
  const lots = [
    lot("late", 300, "2026-12-31T00:00:00Z"),
    lot("early", 200, "2026-12-01T00:00:00Z"),
    lot("expired", 1000, "2025-06-30T00:00:00Z"),
  ];
  const { router, loyalty } = app([pendingOrder()], lots);
  const res = await redeem(router, "o1", { points: 400, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.equal((res.body as { pointsAppliedCents: number }).pointsAppliedCents, 400);
  assert.equal((await loyalty.getLot("early"))!.points, 0);
  assert.equal((await loyalty.getLot("late"))!.points, 100);
  assert.equal((await loyalty.getLot("expired"))!.points, 1000);
});

test("LOY-002: points beyond the amount due are not consumed", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("l1", 20000, "2026-12-31T00:00:00Z")]);
  const res = await redeem(router, "o1", { points: 15000, idempotencyKey: "k1" });
  // subtotal is 10000: only 10000 points are applied, the amount never goes below zero
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 0, pointsAppliedCents: 10000, taxCents: 0, totalCents: 0 });
  assert.equal((await loyalty.getLot("l1"))!.points, 10000);
});

test("LOY-002: a repeated idempotency key returns the same result and consumes nothing more", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("l1", 1000, "2026-12-31T00:00:00Z")]);
  const first = await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  const second = await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal((await loyalty.getLot("l1"))!.points, 700);
});

test("LOY-002: the same idempotency key with a different body is rejected", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("l1", 1000, "2026-12-31T00:00:00Z")]);
  await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  const res = await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  assert.equal(res.status, 422);
  assert.equal((await loyalty.getLot("l1"))!.points, 700);
});

test("LOY-002: concurrent redemptions for one customer never spend the same points", async () => {
  const { router, loyalty } = app(
    [pendingOrder({ id: "o1" }), pendingOrder({ id: "o2" })],
    [lot("l1", 800, "2026-12-31T00:00:00Z")],
  );
  const results = await Promise.all([
    redeem(router, "o1", { points: 500, idempotencyKey: "a" }),
    redeem(router, "o2", { points: 500, idempotencyKey: "b" }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await loyalty.getLot("l1"))!.points, 300);
});

test("LOY-002: cancelling a redeemed order returns points to their original lots and expiry", async () => {
  const lots = [lot("late", 300, "2026-12-31T00:00:00Z"), lot("early", 200, "2026-12-01T00:00:00Z")];
  const { router, loyalty } = app([pendingOrder()], lots);
  await redeem(router, "o1", { points: 400, idempotencyKey: "k1" });
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal((await loyalty.getLot("early"))!.points, 200);
  assert.equal((await loyalty.getLot("late"))!.points, 300);
  assert.equal((await loyalty.getLot("early"))!.expiresAt.toISOString(), "2026-12-01T00:00:00.000Z");
});

test("LOY-002: points whose lot expired before cancellation are forfeited", async () => {
  let now = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty } = app([pendingOrder()], [lot("soon", 1000, "2026-11-25T00:00:00Z")], () => now);
  await redeem(router, "o1", { points: 200, idempotencyKey: "k1" });
  now = new Date("2026-11-26T00:00:00Z");
  await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal((await loyalty.getLot("soon"))!.points, 800);
});

test("LOY-002: an order can be redeemed only once", async () => {
  const { router } = app([pendingOrder()], [lot("l1", 1000, "2026-12-31T00:00:00Z")]);
  await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k2" });
  assert.equal(res.status, 409);
});

test("LOY-002: only pending orders can be redeemed", async () => {
  const { router, loyalty } = app([pendingOrder({ status: "shipped" })], [lot("l1", 1000, "2026-12-31T00:00:00Z")]);
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal((await loyalty.getLot("l1"))!.points, 1000);
});

test("LOY-002: redeeming more points than the customer holds is rejected", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("l1", 100, "2026-12-31T00:00:00Z")]);
  const res = await redeem(router, "o1", { points: 101, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal((await loyalty.getLot("l1"))!.points, 100);
});

test("LOY-002: another customer's order cannot be redeemed", async () => {
  const { router } = app([pendingOrder()], [lot("l1", 1000, "2026-12-31T00:00:00Z")]);
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" }, asBob);
  assert.equal(res.status, 404);
});

test("LOY-002: redemption requires a signed-in customer and a valid body", async () => {
  const { router } = app([pendingOrder()], [lot("l1", 1000, "2026-12-31T00:00:00Z")]);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k1" }, {})).status, 401);
  assert.equal((await redeem(router, "o1", { points: 0, idempotencyKey: "k1" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 1.5, idempotencyKey: "k1" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 100 })).status, 400);
});
