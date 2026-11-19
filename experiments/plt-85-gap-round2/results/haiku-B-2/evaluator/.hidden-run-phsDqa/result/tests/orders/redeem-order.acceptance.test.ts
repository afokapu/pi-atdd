/**
 * Acceptance LOY-002
 * POST /orders/:id/redeem pays part of a pending order with points. Points come from
 * non-expired lots, earliest expiry first; they reduce the amount after discount and
 * before tax, never below zero. Idempotent by key; concurrent redemptions never double-spend;
 * cancelling returns points to their original lots unless those lots have expired.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "./helpers.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const T0 = new Date("2026-11-19T12:00:00Z");
const lot = (id: string, points: number, expiresAt: string, customerId = "alice"): PointsLot =>
  ({ id, customerId, points, expiresAt: new Date(expiresAt) });
const redeem = (router: ReturnType<typeof app>["router"], body: unknown, orderId = "o1") =>
  router.handle({ method: "POST", path: `/orders/${orderId}/redeem`, headers: asAlice, body });

test("LOY-002: points spend the earliest-expiring lots and reduce the amount before tax", async () => {
  const lots = [lot("lot-late", 500, "2026-12-31T00:00:00Z"), lot("lot-early", 300, "2026-12-01T00:00:00Z")];
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], lots, () => T0);
  const res = await redeem(router, { points: 400, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  // subtotal 10000, SAVE10 -1000 => 9000; 400 points => 8600; DE tax 19% => 1634
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 1000, pointsAppliedCents: 400, taxCents: 1634, totalCents: 10234 });
  assert.equal((await loyalty.getLot("lot-early"))!.points, 0);
  assert.equal((await loyalty.getLot("lot-late"))!.points, 400);
});

test("LOY-002: excess points are not consumed beyond the amount payable", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("lot-a", 100000, "2026-12-31T00:00:00Z")], () => T0);
  const res = await redeem(router, { points: 50000, idempotencyKey: "k1" });
  assert.equal((res.body as { pointsAppliedCents: number }).pointsAppliedCents, 10000);
  assert.equal((await loyalty.getLot("lot-a"))!.points, 90000);
});

test("LOY-002: expired lots are not spent", async () => {
  const lots = [lot("lot-old", 1000, "2025-06-30T00:00:00Z"), lot("lot-ok", 200, "2026-12-31T00:00:00Z")];
  const { router, loyalty } = app([pendingOrder()], lots, () => T0);
  const res = await redeem(router, { points: 500, idempotencyKey: "k1" });
  assert.equal((res.body as { pointsAppliedCents: number }).pointsAppliedCents, 200);
  assert.equal((await loyalty.getLot("lot-old"))!.points, 1000);
});

test("LOY-002: the same key replays the same result and spends nothing more", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("lot-a", 1000, "2026-12-31T00:00:00Z")], () => T0);
  const first = await redeem(router, { points: 300, idempotencyKey: "k1" });
  const second = await redeem(router, { points: 300, idempotencyKey: "k1" });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal((await loyalty.getLot("lot-a"))!.points, 700);
});

test("LOY-002: the same key with a different body is rejected", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("lot-a", 1000, "2026-12-31T00:00:00Z")], () => T0);
  await redeem(router, { points: 300, idempotencyKey: "k1" });
  const res = await redeem(router, { points: 301, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal((res.body as { error_code: string }).error_code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal((await loyalty.getLot("lot-a"))!.points, 700);
});

test("LOY-002: concurrent redemptions for one customer never spend the same points", async () => {
  const { router, loyalty } = app(
    [pendingOrder({ id: "o1" }), pendingOrder({ id: "o2" })],
    [lot("lot-a", 300, "2026-12-31T00:00:00Z")],
    () => T0,
  );
  const [a, b] = await Promise.all([
    redeem(router, { points: 300, idempotencyKey: "ka" }, "o1"),
    redeem(router, { points: 300, idempotencyKey: "kb" }, "o2"),
  ]);
  const applied = [a, b].map(r => (r.body as { pointsAppliedCents: number }).pointsAppliedCents).sort((x, y) => x - y);
  assert.deepEqual(applied, [0, 300]);
  assert.equal((await loyalty.getLot("lot-a"))!.points, 0);
});

test("LOY-002: a second redemption with another key on the same order is rejected", async () => {
  const { router } = app([pendingOrder()], [lot("lot-a", 1000, "2026-12-31T00:00:00Z")], () => T0);
  await redeem(router, { points: 100, idempotencyKey: "k1" });
  const res = await redeem(router, { points: 100, idempotencyKey: "k2" });
  assert.equal(res.status, 409);
});

test("LOY-002: cancelling a redeemed order returns points to their original lots and expiry", async () => {
  const lots = [lot("lot-early", 300, "2026-12-01T00:00:00Z"), lot("lot-late", 500, "2026-12-31T00:00:00Z")];
  const { router, loyalty } = app([pendingOrder()], lots, () => T0);
  await redeem(router, { points: 400, idempotencyKey: "k1" });
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal((await loyalty.getLot("lot-early"))!.points, 300);
  assert.equal((await loyalty.getLot("lot-late"))!.points, 500);
  assert.equal((await loyalty.getLot("lot-early"))!.expiresAt.toISOString(), "2026-12-01T00:00:00.000Z");
});

test("LOY-002: points from a lot that expired before cancellation are forfeited", async () => {
  let clock = T0;
  const { router, loyalty } = app([pendingOrder()], [lot("lot-a", 300, "2026-11-25T00:00:00Z")], () => clock);
  await redeem(router, { points: 300, idempotencyKey: "k1" });
  clock = new Date("2026-11-26T00:00:00Z");
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal((await loyalty.getLot("lot-a"))!.points, 0);
});

test("LOY-002: another customer cannot redeem an order", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("lot-a", 1000, "2026-12-31T00:00:00Z")], () => T0);
  const res = await router.handle({ method: "POST", path: "/orders/o1/redeem", headers: asBob, body: { points: 100, idempotencyKey: "k1" } });
  assert.equal(res.status, 404);
  assert.equal((await loyalty.getLot("lot-a"))!.points, 1000);
});

test("LOY-002: shipped orders cannot take a redemption", async () => {
  const { router } = app([pendingOrder({ status: "shipped" })], [lot("lot-a", 1000, "2026-12-31T00:00:00Z")], () => T0);
  const res = await redeem(router, { points: 100, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
});

test("LOY-002: invalid bodies are rejected before the ledger is touched", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("lot-a", 1000, "2026-12-31T00:00:00Z")], () => T0);
  for (const body of [{ points: 0, idempotencyKey: "k" }, { points: 1.5, idempotencyKey: "k" }, { points: 10 }, { points: 10, idempotencyKey: " " }]) {
    assert.equal((await redeem(router, body)).status, 400);
  }
  assert.equal((await loyalty.getLot("lot-a"))!.points, 1000);
});
