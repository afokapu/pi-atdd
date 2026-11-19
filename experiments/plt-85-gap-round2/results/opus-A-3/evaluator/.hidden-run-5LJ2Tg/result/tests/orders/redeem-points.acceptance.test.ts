/**
 * Acceptance LOY-002 — Pay with loyalty points (POST /orders/:id/redeem).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "./helpers.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const NOW = new Date("2026-11-19T12:00:00Z");
const lot = (id: string, points: number, expiresAt: string, customerId = "alice"): PointsLot =>
  ({ id, customerId, points, expiresAt: new Date(expiresAt) });
const redeem = (router: ReturnType<typeof app>["router"], body: unknown, headers = asAlice, id = "o1") =>
  router.handle({ method: "POST", path: "/orders/" + id + "/redeem", headers, body });
const pts = async (l: ReturnType<typeof app>["loyalty"], id: string) => (await l.getLot(id))!.points;

test("LOY-002: points reduce the amount after discount and before tax", async () => {
  // subtotal 10000, SAVE10 -> 9000, 500 points -> 8500, tax 19% -> 1615
  const { router } = app([pendingOrder({ discountCode: "SAVE10" })], [lot("l1", 800, "2026-12-31T00:00:00Z")]);
  const res = await redeem(router, { points: 500, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 1000, pointsApplied: 500,
    pointsAppliedCents: 500, taxCents: 1615, totalCents: 10115 });
  const q = await router.handle({ method: "GET", path: "/orders/o1/quote", headers: asAlice });
  assert.deepEqual(q.body, res.body);
});

test("LOY-002: earliest-expiring non-expired lots first", async () => {
  const { router, loyalty } = app([pendingOrder()], [
    lot("late", 300, "2026-12-31T00:00:00Z"), lot("soon", 500, "2026-12-01T00:00:00Z"),
    lot("expired", 1000, "2025-06-30T00:00:00Z"), lot("at-now", 1000, NOW.toISOString()),
  ]);
  const res = await redeem(router, { points: 600, idempotencyKey: "k" });
  assert.equal(res.status, 200);
  assert.equal(await pts(loyalty, "soon"), 0);
  assert.equal(await pts(loyalty, "late"), 200);
  assert.equal(await pts(loyalty, "expired"), 1000);
  assert.equal(await pts(loyalty, "at-now"), 1000);
});

test("LOY-002: not enough non-expired points is rejected and nothing is consumed", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("a", 100, "2026-12-31T00:00:00Z"), lot("x", 5000, "2025-01-01T00:00:00Z")]);
  const res = await redeem(router, { points: 200, idempotencyKey: "k" });
  assert.equal(res.status, 409);
  assert.equal(await pts(loyalty, "a"), 100);
});

test("LOY-002: never below zero; excess points are not consumed", async () => {
  // subtotal 1000, FLAT5 -> 500 payable
  const { router, loyalty } = app([pendingOrder({ discountCode: "FLAT5", lines: [{ sku: "s", unitPriceCents: 1000, quantity: 1 }] })],
    [lot("a", 2000, "2026-12-31T00:00:00Z")]);
  const res = await redeem(router, { points: 2000, idempotencyKey: "k" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 1000, discountCents: 500, pointsApplied: 500,
    pointsAppliedCents: 500, taxCents: 0, totalCents: 0 });
  assert.equal(await pts(loyalty, "a"), 1500);
  // Further redemption consumes nothing.
  const again = await redeem(router, { points: 100, idempotencyKey: "k2" });
  assert.equal(again.status, 200);
  assert.equal((again.body as { totalCents: number }).totalCents, 0);
  assert.equal(await pts(loyalty, "a"), 1500);
});

test("LOY-002: same key -> same result, nothing more consumed; different body -> rejected", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("a", 1000, "2026-12-31T00:00:00Z")]);
  const first = await redeem(router, { points: 300, idempotencyKey: "k" });
  const second = await redeem(router, { points: 300, idempotencyKey: "k" });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal(await pts(loyalty, "a"), 700);
  const conflict = await redeem(router, { points: 400, idempotencyKey: "k" });
  assert.equal(conflict.status, 422);
  assert.equal(await pts(loyalty, "a"), 700);
});

test("LOY-002: concurrent same-key requests consume once", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("a", 1000, "2026-12-31T00:00:00Z")]);
  const rs = await Promise.all([1, 2, 3].map(() => redeem(router, { points: 300, idempotencyKey: "k" })));
  assert.ok(rs.every(r => r.status === 200));
  assert.equal(await pts(loyalty, "a"), 700);
});

test("LOY-002: concurrent redemptions never spend the same points", async () => {
  const orders = [pendingOrder({ id: "o1" }), pendingOrder({ id: "o2" }), pendingOrder({ id: "o3" })];
  const { router, loyalty } = app(orders, [lot("a", 500, "2026-12-31T00:00:00Z"), lot("b", 500, "2027-01-31T00:00:00Z")]);
  const rs = await Promise.all(["o1", "o2", "o3"].map((id, i) => redeem(router, { points: 400, idempotencyKey: "k" + i }, asAlice, id)));
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 200, 409]);
  assert.equal((await pts(loyalty, "a")) + (await pts(loyalty, "b")), 200);
});

test("LOY-002: only the owner of a pending order; input validated", async () => {
  const { router } = app([pendingOrder(), pendingOrder({ id: "o2", status: "shipped" })], [lot("a", 1000, "2026-12-31T00:00:00Z")]);
  assert.equal((await redeem(router, { points: 100, idempotencyKey: "k" }, asBob)).status, 404);
  assert.equal((await redeem(router, { points: 100, idempotencyKey: "k" }, {})).status, 401);
  assert.equal((await redeem(router, { points: 100, idempotencyKey: "k" }, asAlice, "o2")).status, 409);
  assert.equal((await redeem(router, { points: 1.5, idempotencyKey: "k" })).status, 400);
  assert.equal((await redeem(router, { points: 0, idempotencyKey: "k" })).status, 400);
  assert.equal((await redeem(router, { points: 100 })).status, 400);
});

test("LOY-002: cancel returns points to original lots; expired lots forfeit", async () => {
  let now = NOW;
  const orders = [pendingOrder()];
  const { router, loyalty } = app(orders, [lot("soon", 300, "2026-11-25T00:00:00Z"), lot("late", 500, "2027-06-01T00:00:00Z")], () => now);
  assert.equal((await redeem(router, { points: 600, idempotencyKey: "k" })).status, 200);
  assert.equal(await pts(loyalty, "soon"), 0);
  assert.equal(await pts(loyalty, "late"), 200);
  now = new Date("2026-12-01T00:00:00Z"); // "soon" has expired
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal(await pts(loyalty, "soon"), 0);
  assert.equal(await pts(loyalty, "late"), 500);
  assert.equal((await loyalty.getLot("late"))!.expiresAt.toISOString(), "2027-06-01T00:00:00.000Z");
  // Cancelling again does not return points twice.
  assert.equal((await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice })).status, 409);
  assert.equal(await pts(loyalty, "late"), 500);
});

test("LOY-002: concurrent cancel and redeem do not leak or double-return points", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("a", 1000, "2027-01-01T00:00:00Z")]);
  await redeem(router, { points: 400, idempotencyKey: "k1" });
  await Promise.all([
    router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice }),
    redeem(router, { points: 300, idempotencyKey: "k2" }),
    router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice }),
  ]);
  assert.equal(await pts(loyalty, "a"), 1000);
});
