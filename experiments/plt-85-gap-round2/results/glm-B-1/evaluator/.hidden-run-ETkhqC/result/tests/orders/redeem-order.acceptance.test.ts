/**
 * Acceptance LOY-002
 * POST /orders/:id/redeem lets the signed-in owner of a pending order pay part
 * of it with points: non-expired lots are consumed earliest-expiry-first
 * (100 points = 1 EUR), the applied points reduce the amount after discounts
 * and before tax and never below zero, the same idempotency key replays the
 * same result while a different body is rejected, concurrent redemptions of
 * one customer never spend the same points, and cancelling a redeemed order
 * returns points to their original lots unless the lot expired in between.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "./helpers.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";
import type { PointsQuote } from "../../src/pricing/domain/quote.ts";

/** Alice's lot factory: far-future expiry unless overridden. */
const lot = (over: Partial<PointsLot> = {}, id = "lot-1"): PointsLot => ({
  id, customerId: "alice", points: 500, expiresAt: new Date("2027-06-30T00:00:00Z"), ...over,
});

const redeem = (router: ReturnType<typeof app>["router"], id: string, body: unknown, headers = asAlice) =>
  router.handle({ method: "POST", path: `/orders/${id}/redeem`, headers, body });

const pointsOf = async (loyalty: ReturnType<typeof app>["loyalty"], id: string) =>
  (await loyalty.getLot(id))!.points;

test("LOY-002: consumes non-expired lots earliest expiry first", async () => {
  const { router, loyalty } = app([pendingOrder()], [
    lot({ id: "lot-late", points: 300, expiresAt: new Date("2026-12-31T00:00:00Z") }),
    lot({ id: "lot-soon", points: 500, expiresAt: new Date("2026-12-01T00:00:00Z") }),
    lot({ id: "lot-old", points: 1000, expiresAt: new Date("2025-06-30T00:00:00Z") }),
  ]);
  const res = await redeem(router, "o1", { points: 400, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  // 10000 cents - 400 points = 9600 pre-tax; 19% tax = 1824; total 11424
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 0, pointsCents: 400, taxCents: 1824, totalCents: 11424 });
  assert.equal(await pointsOf(loyalty, "lot-soon"), 100); // earliest expiring lot pays first
  assert.equal(await pointsOf(loyalty, "lot-late"), 300); // untouched
  assert.equal(await pointsOf(loyalty, "lot-old"), 1000); // expired lots are never consumed
});

test("LOY-002: points reduce the amount after discount and before tax, never below zero", async () => {
  const { router } = app(
    [pendingOrder({ discountCode: "SAVE10", lines: [{ sku: "sku-1", unitPriceCents: 2500, quantity: 4 }] })],
    [lot({ points: 10000 })]);
  // subtotal 10000, SAVE10 = 1000 off, taxable 9000; 9000 points applied -> 0 pre-tax, tax 0, total 0
  const res = await redeem(router, "o1", { points: 9000, idempotencyKey: "k2" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 1000, pointsCents: 9000, taxCents: 0, totalCents: 0 });
});

test("LOY-002: excess points are not consumed", async () => {
  const { router, loyalty } = app(
    [pendingOrder({ discountCode: "FLAT5", lines: [{ sku: "mug", unitPriceCents: 1250, quantity: 4 }] })],
    [lot({ points: 20000 })]);
  // subtotal 5000, FLAT5 = 500 off, taxable 4500: only 4500 points may be consumed
  const res = await redeem(router, "o1", { points: 20000, idempotencyKey: "k3" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 5000, discountCents: 500, pointsCents: 4500, taxCents: 0, totalCents: 0 });
  assert.equal(await pointsOf(loyalty, "lot-1"), 15500); // only the capped amount was spent
});

test("LOY-002: only the points still available in lots are consumed", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot({ points: 250 })]);
  const res = await redeem(router, "o1", { points: 400, idempotencyKey: "k4" });
  assert.equal(res.status, 200);
  const body = res.body as PointsQuote;
  assert.equal(body.pointsCents, 250);
  assert.equal(body.taxCents, 1853); // 19% of 9750, rounded to the nearest cent
  assert.equal(body.totalCents, 11603);
  assert.equal(await pointsOf(loyalty, "lot-1"), 0);
});

test("LOY-002: same key and same body replays the same result, consuming nothing more", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot({ points: 500 })]);
  const req = { points: 300, idempotencyKey: "k5" };
  const first = await redeem(router, "o1", req);
  const second = await redeem(router, "o1", req);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal(await pointsOf(loyalty, "lot-1"), 200); // debited exactly once
});

test("LOY-002: same key with a different body is rejected", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot({ points: 500 })]);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k6" })).status, 200);
  const res = await redeem(router, "o1", { points: 200, idempotencyKey: "k6" });
  assert.equal(res.status, 409);
  assert.equal(await pointsOf(loyalty, "lot-1"), 400); // nothing further consumed
});

test("LOY-002: a second redemption under a new key is rejected", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot({ points: 500 })]);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k7a" })).status, 200);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k7b" })).status, 409);
  assert.equal(await pointsOf(loyalty, "lot-1"), 400);
});

test("LOY-002: rejects invalid bodies, other customers and non-pending orders", async () => {
  const { router } = app(
    [pendingOrder(), pendingOrder({ id: "o2", customerId: "bob" }), pendingOrder({ id: "o3", status: "shipped" })],
    [lot()]);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k" }, {})).status, 401);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k" }, asBob)).status, 404);
  assert.equal((await redeem(router, "o2", { points: 100, idempotencyKey: "k" }, asBob)).status, 200);
  for (const points of [0, -5, 2.5, "100", undefined]) {
    assert.equal((await redeem(router, "o1", { points, idempotencyKey: "k" })).status, 400, `points=${points}`);
  }
  for (const key of [undefined, "", 42]) {
    assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: key })).status, 400, `key=${key}`);
  }
  assert.equal((await redeem(router, "o3", { points: 100, idempotencyKey: "k9" })).status, 409);
});

test("LOY-002: concurrent redemptions of one customer never spend the same points", async () => {
  const { router, loyalty } = app(
    [pendingOrder({ id: "o1" }), pendingOrder({ id: "o2", lines: [{ sku: "x", unitPriceCents: 3000, quantity: 1 }] })],
    [lot({ points: 300 })]);
  const [r1, r2] = await Promise.all([
    redeem(router, "o1", { points: 300, idempotencyKey: "ka" }),
    redeem(router, "o2", { points: 300, idempotencyKey: "kb" }),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const spent = (r1.body as PointsQuote).pointsCents + (r2.body as PointsQuote).pointsCents;
  assert.equal(spent, 300); // the 300 available points were spent exactly once, not twice
  assert.equal(await pointsOf(loyalty, "lot-1"), 0);
});

test("LOY-002: concurrent double submit of the same redemption applies once", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot({ points: 300 })]);
  const req = { points: 300, idempotencyKey: "same" };
  const [r1, r2] = await Promise.all([redeem(router, "o1", req), redeem(router, "o1", req)]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.body, r1.body);
  assert.equal(await pointsOf(loyalty, "lot-1"), 0);
});

test("LOY-002: cancelling a redeemed order returns points to their original lots", async () => {
  const { router, loyalty } = app([pendingOrder()], [
    lot({ id: "lot-soon", points: 500, expiresAt: new Date("2026-12-01T00:00:00Z") }),
    lot({ id: "lot-late", points: 300, expiresAt: new Date("2026-12-31T00:00:00Z") }),
  ]);
  const redeemed = await redeem(router, "o1", { points: 600, idempotencyKey: "k10" });
  assert.deepEqual((redeemed.body as PointsQuote).pointsCents, 600); // 500 from lot-soon + 100 from lot-late
  const cancel = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(cancel.status, 200);
  assert.equal(await pointsOf(loyalty, "lot-soon"), 500); // original lot, original expiry preserved
  assert.equal(await pointsOf(loyalty, "lot-late"), 300);
  // A replay after the refund neither consumes nor refunds anything again.
  const replay = await redeem(router, "o1", { points: 600, idempotencyKey: "k10" });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, redeemed.body);
  assert.equal(await pointsOf(loyalty, "lot-soon"), 500);
});

test("LOY-002: cancelling after a lot expired forfeits that lot's redeemed points", async () => {
  let clock = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty, orders } = app(
    [pendingOrder()],
    [lot({ points: 500, expiresAt: new Date("2026-12-01T00:00:00Z") })],
    () => clock);
  assert.equal((await redeem(router, "o1", { points: 300, idempotencyKey: "k11" })).status, 200);
  assert.equal(await pointsOf(loyalty, "lot-1"), 200);
  clock = new Date("2026-12-15T00:00:00Z"); // the lot has expired by cancellation time
  const cancel = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(cancel.status, 200);
  assert.equal(orders.get("o1")!.status, "cancelled");
  assert.equal(await pointsOf(loyalty, "lot-1"), 200); // the 300 points are forfeited
});
