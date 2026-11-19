/**
 * Acceptance LOY-002: pay part of a pending order with loyalty points.
 * 100 points = 1 EUR (1 point = 1 cent). Points apply after discount and before tax, never
 * below zero. Lots are drawn earliest-expiry first; cancelling returns points to their lots.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "./helpers.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";
import type { Order } from "../../src/orders/domain/order.ts";

const NOW = new Date("2026-11-19T12:00:00Z");
const lots = (): PointsLot[] => [
  { id: "lot-1", customerId: "alice", points: 500, expiresAt: new Date("2026-12-01T00:00:00Z") },
  { id: "lot-2", customerId: "alice", points: 1000, expiresAt: new Date("2026-12-31T00:00:00Z") },
  { id: "lot-old", customerId: "alice", points: 900, expiresAt: new Date("2025-06-30T00:00:00Z") },
];
const redeem = (router: ReturnType<typeof app>["router"], id: string, body: unknown, headers = asAlice) =>
  router.handle({ method: "POST", path: `/orders/${id}/redeem`, headers, body });
const pointsOf = async (loyalty: ReturnType<typeof app>["loyalty"], id: string) => (await loyalty.getLot(id))!.points;
const oneLine = (unitPriceCents: number): Order[] => [pendingOrder({ lines: [{ sku: "x", unitPriceCents, quantity: 1 }] })];

test("LOY-002: points are drawn earliest expiry first, expired lots untouched, points applied before tax", async () => {
  const { router, loyalty } = app([pendingOrder()], lots(), () => NOW);
  const res = await redeem(router, "o1", { points: 800, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 0, pointsCents: 800, taxCents: 1748, totalCents: 10948 });
  assert.equal(await pointsOf(loyalty, "lot-1"), 0);
  assert.equal(await pointsOf(loyalty, "lot-2"), 700);
  assert.equal(await pointsOf(loyalty, "lot-old"), 900);
});

test("LOY-002: points come after the discount and before tax", async () => {
  const { router } = app([pendingOrder({ discountCode: "SAVE10" })], lots(), () => NOW);
  const res = await redeem(router, "o1", { points: 800, idempotencyKey: "k1" });
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 1000, pointsCents: 800, taxCents: 1558, totalCents: 9758 });
});

test("LOY-002: excess points are not consumed and the total never goes below zero", async () => {
  const { router, loyalty } = app(oneLine(1000), lots(), () => NOW);
  const res = await redeem(router, "o1", { points: 5000, idempotencyKey: "k1" });
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 1000, discountCents: 0, pointsCents: 1000, taxCents: 0, totalCents: 0 });
  assert.equal(await pointsOf(loyalty, "lot-1"), 0);
  assert.equal(await pointsOf(loyalty, "lot-2"), 500);
});

test("LOY-002: same key and body replays the stored result without consuming more points", async () => {
  const { router, loyalty } = app([pendingOrder()], lots(), () => NOW);
  const first = await redeem(router, "o1", { points: 800, idempotencyKey: "k1" });
  const second = await redeem(router, "o1", { points: 800, idempotencyKey: "k1" });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal(await pointsOf(loyalty, "lot-2"), 700);
});

test("LOY-002: same key with a different body is rejected and changes nothing", async () => {
  const { router, loyalty } = app([pendingOrder()], lots(), () => NOW);
  await redeem(router, "o1", { points: 800, idempotencyKey: "k1" });
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal((res.body as { error_code: string }).error_code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(await pointsOf(loyalty, "lot-2"), 700);
});

test("LOY-002: cancelling a redeemed order restores points to their original lots and expiry", async () => {
  const { router, loyalty } = app([pendingOrder()], lots(), () => NOW);
  await redeem(router, "o1", { points: 800, idempotencyKey: "k1" });
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal(await pointsOf(loyalty, "lot-1"), 500);
  assert.equal(await pointsOf(loyalty, "lot-2"), 1000);
  assert.equal((await loyalty.getLot("lot-1"))!.expiresAt.toISOString(), "2026-12-01T00:00:00.000Z");
  assert.equal((await loyalty.lotsFor("alice")).length, 3);
});

test("LOY-002: points whose lot expired before the cancellation are forfeited", async () => {
  let now = NOW;
  const { router, loyalty } = app([pendingOrder()], lots(), () => now);
  await redeem(router, "o1", { points: 800, idempotencyKey: "k1" });
  now = new Date("2026-12-15T00:00:00Z"); // lot-1 (expires 2026-12-01) has lapsed; lot-2 has not
  await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(await pointsOf(loyalty, "lot-1"), 0);
  assert.equal(await pointsOf(loyalty, "lot-2"), 1000);
});

test("LOY-002: concurrent redemptions for one customer never spend the same points", async () => {
  const seed = [pendingOrder({ id: "o1" }), pendingOrder({ id: "o2" })];
  const { router, loyalty } = app(seed, [lots()[1]!], () => NOW);
  const results = await Promise.all([
    redeem(router, "o1", { points: 1000, idempotencyKey: "a" }),
    redeem(router, "o2", { points: 1000, idempotencyKey: "b" }),
  ]);
  const applied = results.map(r => (r.body as { pointsCents: number }).pointsCents).sort((x, y) => x - y);
  assert.deepEqual(applied, [0, 1000]);
  assert.equal(await pointsOf(loyalty, "lot-2"), 0);
});

test("LOY-002: another customer's order is not found", async () => {
  const { router, loyalty } = app([pendingOrder()], lots(), () => NOW);
  const res = await redeem(router, "o1", { points: 800, idempotencyKey: "k1" }, asBob);
  assert.equal(res.status, 404);
  assert.equal(await pointsOf(loyalty, "lot-2"), 1000);
});

test("LOY-002: only pending orders can be paid with points", async () => {
  const { router, loyalty } = app([pendingOrder({ status: "shipped" })], lots(), () => NOW);
  const res = await redeem(router, "o1", { points: 800, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal(await pointsOf(loyalty, "lot-2"), 1000);
});

test("LOY-002: an order can be paid with points once; a second key is rejected", async () => {
  const { router } = app([pendingOrder()], lots(), () => NOW);
  await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k2" });
  assert.equal(res.status, 409);
  assert.equal((res.body as { error_code: string }).error_code, "ORDER_ALREADY_REDEEMED");
});

test("LOY-002: invalid body and anonymous callers are refused", async () => {
  const { router } = app([pendingOrder()], lots(), () => NOW);
  assert.equal((await redeem(router, "o1", { points: 0, idempotencyKey: "k1" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 10 })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 10, idempotencyKey: "k1" }, {})).status, 401);
});
