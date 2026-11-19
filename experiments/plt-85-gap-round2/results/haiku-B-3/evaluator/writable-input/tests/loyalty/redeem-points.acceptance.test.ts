/**
 * Acceptance LOY-002
 * POST /orders/:id/redeem pays part of a pending order with points. Points come from
 * non-expired lots, earliest expiry first, 100 points = 1 EUR (1 point = 1 cent). They
 * reduce the amount after discounts and before tax, never below zero. A repeated key
 * replays the first result; concurrent redemptions never spend the same points; cancelling
 * returns points to their original lots unless those have expired.
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
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], [lot("lot-x", 300, "2026-12-31T00:00:00Z")]);
  const res = await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  // subtotal 10000, SAVE10 -1000, points -300 -> taxable 8700, 19% tax 1653, total 10353
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 10000, discountCents: 1000, pointsAppliedCents: 300, taxCents: 1653, totalCents: 10353,
  });
  assert.equal((await loyalty.getLot("lot-x"))!.points, 0);
});

test("LOY-002: points are consumed earliest expiry first", async () => {
  const { router, loyalty } = app([pendingOrder()], [
    lot("lot-late", 500, "2027-06-30T00:00:00Z"),
    lot("lot-early", 200, "2026-12-01T00:00:00Z"),
  ]);
  await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  assert.equal((await loyalty.getLot("lot-early"))!.points, 0);
  assert.equal((await loyalty.getLot("lot-late"))!.points, 400);
});

test("LOY-002: expired lots are never spent", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("lot-old", 1000, "2025-06-30T00:00:00Z")]);
  const res = await redeem(router, "o1", { points: 1000, idempotencyKey: "k1" });
  assert.equal((res.body as { pointsAppliedCents: number }).pointsAppliedCents, 0);
  assert.equal((await loyalty.getLot("lot-old"))!.points, 1000);
});

test("LOY-002: excess points are not consumed", async () => {
  // order subtotal is 10000 cents with no discount; 100000 points requested, only 10000 are applied and spent
  const { router, loyalty } = app([pendingOrder()], [lot("lot-x", 100000, "2027-06-30T00:00:00Z")]);
  const res = await redeem(router, "o1", { points: 100000, idempotencyKey: "k1" });
  assert.equal((res.body as { pointsAppliedCents: number }).pointsAppliedCents, 10000);
  assert.equal((await loyalty.getLot("lot-x"))!.points, 90000);
});

test("LOY-002: a repeated key replays the result and consumes nothing more", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("lot-x", 1000, "2027-06-30T00:00:00Z")]);
  const first = await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  const second = await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal((await loyalty.getLot("lot-x"))!.points, 700);
});

test("LOY-002: a reused key with a different body is rejected", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("lot-x", 1000, "2027-06-30T00:00:00Z")]);
  await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  const res = await redeem(router, "o1", { points: 500, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal((res.body as { error_code: string }).error_code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal((await loyalty.getLot("lot-x"))!.points, 700);
});

test("LOY-002: concurrent redemptions never spend the same points", async () => {
  const { router, loyalty } = app(
    [pendingOrder({ id: "o1" }), pendingOrder({ id: "o2" })],
    [lot("lot-x", 800, "2027-06-30T00:00:00Z")],
  );
  const [a, b] = await Promise.all([
    redeem(router, "o1", { points: 800, idempotencyKey: "ka" }),
    redeem(router, "o2", { points: 800, idempotencyKey: "kb" }),
  ]);
  const applied = [a, b].map(r => (r.body as { pointsAppliedCents: number }).pointsAppliedCents).sort();
  assert.deepEqual(applied, [0, 800]);
  assert.equal((await loyalty.getLot("lot-x"))!.points, 0);
});

test("LOY-002: only pending orders can be redeemed", async () => {
  const { router, loyalty } = app([pendingOrder({ status: "shipped" })], [lot("lot-x", 500, "2027-06-30T00:00:00Z")]);
  const res = await redeem(router, "o1", { points: 300, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal((await loyalty.getLot("lot-x"))!.points, 500);
});

test("LOY-002: another customer's order cannot be redeemed", async () => {
  const { router } = app([pendingOrder()], [lot("lot-x", 500, "2027-06-30T00:00:00Z")]);
  const res = await redeem(router, "o1", { points: 300, idempotencyKey: "k1" }, asBob);
  assert.equal(res.status, 404);
});

test("LOY-002: malformed body is rejected", async () => {
  const { router } = app([pendingOrder()]);
  assert.equal((await redeem(router, "o1", { points: 0, idempotencyKey: "k1" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 1.5, idempotencyKey: "k1" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 10 })).status, 400);
});

test("LOY-002: cancelling a redeemed order returns points to their original lot and expiry", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("lot-early", 200, "2026-12-01T00:00:00Z")]);
  await redeem(router, "o1", { points: 200, idempotencyKey: "k1" });
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  const restored = (await loyalty.getLot("lot-early"))!;
  assert.equal(restored.points, 200);
  assert.equal(restored.expiresAt.toISOString(), "2026-12-01T00:00:00.000Z");
});

test("LOY-002: points whose lot expired before the cancellation are forfeited", async () => {
  let clock = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty } = app([pendingOrder()], [lot("lot-early", 200, "2026-12-01T00:00:00Z")], () => clock);
  await redeem(router, "o1", { points: 200, idempotencyKey: "k1" });
  clock = new Date("2026-12-02T00:00:00Z");
  await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal((await loyalty.getLot("lot-early"))!.points, 0);
});

test("LOY-002: a cancelled order cannot be redeemed, and a redeemed order cannot be redeemed again", async () => {
  const { router } = app([pendingOrder()], [lot("lot-x", 1000, "2027-06-30T00:00:00Z")]);
  await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  const again = await redeem(router, "o1", { points: 100, idempotencyKey: "k2" });
  assert.equal((again.body as { error_code: string }).error_code, "ORDER_ALREADY_REDEEMED");
  await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  const afterCancel = await redeem(router, "o1", { points: 100, idempotencyKey: "k3" });
  assert.equal((afterCancel.body as { error_code: string }).error_code, "ORDER_NOT_PENDING");
});
