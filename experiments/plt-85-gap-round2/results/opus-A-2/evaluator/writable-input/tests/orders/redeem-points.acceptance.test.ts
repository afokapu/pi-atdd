/**
 * Acceptance LOY-002 — Pay with loyalty points
 * POST /orders/:id/redeem { points, idempotencyKey } by the owner of a pending order.
 * Non-expired lots, earliest expiry first; 100 points = 1 EUR; after discount, before tax;
 * never below zero, excess not consumed; idempotent; concurrency-safe; cancel restores lots.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "./helpers.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const NOW = new Date("2026-11-19T12:00:00Z");
const lot = (id: string, points: number, expiresAt: string, customerId = "alice"): PointsLot =>
  ({ id, customerId, points, expiresAt: new Date(expiresAt) });
const redeem = (body: unknown, headers = asAlice, id = "o1") =>
  ({ method: "POST" as const, path: `/orders/${id}/redeem`, headers, body });

test("LOY-002: points reduce the amount after discount and before tax", async () => {
  const { router } = app([pendingOrder({ discountCode: "SAVE10" })], [lot("l1", 1000, "2027-01-01T00:00:00Z")]);
  const res = await router.handle(redeem({ points: 1000, idempotencyKey: "k1" }));
  assert.equal(res.status, 200);
  // 10000 - 1000 discount - 1000 points = 8000; tax 19% = 1520
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 1000, pointsApplied: 1000,
    pointsCents: 1000, taxCents: 1520, totalCents: 9520 });
});

test("LOY-002: earliest-expiring non-expired lots are consumed first", async () => {
  const { router, loyalty } = app([pendingOrder()], [
    lot("late", 500, "2027-06-01T00:00:00Z"),
    lot("expired", 1000, "2026-11-19T12:00:00Z"), // expires exactly now: unusable
    lot("soon", 300, "2026-12-01T00:00:00Z"),
  ]);
  const res = await router.handle(redeem({ points: 400, idempotencyKey: "k" }));
  assert.equal(res.status, 200);
  assert.equal((await loyalty.getLot("soon"))!.points, 0);
  assert.equal((await loyalty.getLot("late"))!.points, 400);
  assert.equal((await loyalty.getLot("expired"))!.points, 1000);
});

test("LOY-002: never below zero; excess points are not consumed", async () => {
  const { router, loyalty } = app([pendingOrder({ lines: [{ sku: "x", unitPriceCents: 700, quantity: 1 }], discountCode: "FLAT5" })],
    [lot("l1", 5000, "2027-01-01T00:00:00Z")]);
  const res = await router.handle(redeem({ points: 5000, idempotencyKey: "k" }));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 700, discountCents: 500, pointsApplied: 200,
    pointsCents: 200, taxCents: 0, totalCents: 0 });
  assert.equal((await loyalty.getLot("l1"))!.points, 4800);
});

test("LOY-002: insufficient non-expired points are rejected and nothing is consumed", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("l1", 100, "2027-01-01T00:00:00Z"), lot("old", 900, "2026-01-01T00:00:00Z")]);
  const res = await router.handle(redeem({ points: 500, idempotencyKey: "k" }));
  assert.equal(res.status, 409);
  assert.equal((await loyalty.getLot("l1"))!.points, 100);
});

test("LOY-002: same key replays the result; different body is rejected", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("l1", 1000, "2027-01-01T00:00:00Z")]);
  const a = await router.handle(redeem({ points: 300, idempotencyKey: "k" }));
  const b = await router.handle(redeem({ points: 300, idempotencyKey: "k" }));
  assert.equal(b.status, 200);
  assert.deepEqual(b.body, a.body);
  assert.equal((await loyalty.getLot("l1"))!.points, 700);
  const c = await router.handle(redeem({ points: 301, idempotencyKey: "k" }));
  assert.equal(c.status, 422);
  assert.equal((await loyalty.getLot("l1"))!.points, 700);
});

test("LOY-002: concurrent identical requests consume once", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("l1", 1000, "2027-01-01T00:00:00Z")]);
  const rs = await Promise.all([1, 2, 3].map(() => router.handle(redeem({ points: 300, idempotencyKey: "k" }))));
  assert.deepEqual(rs.map(r => r.status), [200, 200, 200]);
  assert.equal((await loyalty.getLot("l1"))!.points, 700);
});

test("LOY-002: concurrent redemptions never spend the same points", async () => {
  const { router, loyalty } = app(
    [pendingOrder(), pendingOrder({ id: "o2" })],
    [lot("l1", 600, "2027-01-01T00:00:00Z")]);
  const rs = await Promise.all([
    router.handle(redeem({ points: 400, idempotencyKey: "a" }, asAlice, "o1")),
    router.handle(redeem({ points: 400, idempotencyKey: "b" }, asAlice, "o2")),
  ]);
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 409]);
  assert.equal((await loyalty.getLot("l1"))!.points, 200);
});

test("LOY-002: only the owner of a pending order may redeem", async () => {
  const lots = [lot("l1", 1000, "2027-01-01T00:00:00Z"), lot("b1", 1000, "2027-01-01T00:00:00Z", "bob")];
  const { router } = app([pendingOrder(), pendingOrder({ id: "o2", status: "shipped" })], lots);
  assert.equal((await router.handle(redeem({ points: 100, idempotencyKey: "k" }, asBob))).status, 404);
  assert.equal((await router.handle(redeem({ points: 100, idempotencyKey: "k" }, {}))).status, 401);
  assert.equal((await router.handle(redeem({ points: 100, idempotencyKey: "k2" }, asAlice, "o2"))).status, 409);
  assert.equal((await router.handle(redeem({ points: 1.5, idempotencyKey: "k3" }))).status, 400);
  assert.equal((await router.handle(redeem({ points: 100 }))).status, 400);
});

test("LOY-002: cancelling returns points to original lots; expired lots forfeit", async () => {
  let now = NOW;
  const { router, loyalty, orders } = app([pendingOrder()], [
    lot("soon", 300, "2026-12-01T00:00:00Z"),
    lot("late", 1000, "2027-06-01T00:00:00Z"),
  ], () => now);
  assert.equal((await router.handle(redeem({ points: 500, idempotencyKey: "k" }))).status, 200);
  assert.equal((await loyalty.getLot("soon"))!.points, 0);
  assert.equal((await loyalty.getLot("late"))!.points, 800);
  now = new Date("2026-12-05T00:00:00Z"); // "soon" has expired
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal(orders.get("o1")!.status, "cancelled");
  const soon = (await loyalty.getLot("soon"))!, late = (await loyalty.getLot("late"))!;
  assert.equal(soon.points, 0);
  assert.equal(late.points, 1000);
  assert.equal(late.expiresAt.toISOString(), "2027-06-01T00:00:00.000Z");
  // replay after cancel still returns the original result and consumes nothing
  const replay = await router.handle(redeem({ points: 500, idempotencyKey: "k" }));
  assert.equal(replay.status, 200);
  assert.equal((await loyalty.getLot("late"))!.points, 1000);
});

test("LOY-002: GET quote reflects applied points", async () => {
  const { router } = app([pendingOrder()], [lot("l1", 1000, "2027-01-01T00:00:00Z")]);
  const r = await router.handle(redeem({ points: 1000, idempotencyKey: "k" }));
  const q = await router.handle({ method: "GET", path: "/orders/o1/quote", headers: asAlice });
  assert.deepEqual(q.body, r.body);
});
