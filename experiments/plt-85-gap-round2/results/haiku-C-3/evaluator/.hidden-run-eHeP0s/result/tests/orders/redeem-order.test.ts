/**
 * LOY-002: pay part of a pending order with loyalty points.
 * Points are held in lots, consumed earliest-expiry first; 1 point = 1 cent; applied after
 * discount and before tax. Cancelling a redeemed order restores points to their original lots.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "./helpers.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const lot = (id: string, points: number, expiresAt: string, customerId = "alice"): PointsLot =>
  ({ id, customerId, points, expiresAt: new Date(expiresAt) });
const redeem = (router: ReturnType<typeof app>["router"], id: string, body: unknown, headers = asAlice) =>
  router.handle({ method: "POST", path: `/orders/${id}/redeem`, headers, body });
const cancel = (router: ReturnType<typeof app>["router"], id: string) =>
  router.handle({ method: "POST", path: `/orders/${id}/cancel`, headers: asAlice });

/** Clock the test can move forward. */
const clock = (start: string) => {
  let at = new Date(start);
  return { now: () => at, set: (iso: string) => { at = new Date(iso); } };
};

test("LOY-002: points reduce the amount after discount and before tax", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], [lot("lot-x", 1500, "2026-12-31T00:00:00Z")]);
  const res = await redeem(router, "o1", { points: 1000, idempotencyKey: "k1" });
  // subtotal 10000, SAVE10 -> 1000 off, 1000 points -> taxable 8000, 19% tax = 1520
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 1000, pointsCents: 1000, taxCents: 1520, totalCents: 9520 });
  assert.equal((await loyalty.getLot("lot-x"))!.points, 500);
});

test("LOY-002: points are consumed earliest expiry first", async () => {
  const lots = [lot("lot-late", 300, "2026-12-31T00:00:00Z"), lot("lot-early", 500, "2026-12-01T00:00:00Z")];
  const { router, loyalty } = app([pendingOrder()], lots);
  const res = await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.equal((await loyalty.getLot("lot-early"))!.points, 0);
  assert.equal((await loyalty.getLot("lot-late"))!.points, 200);
});

test("LOY-002: expired lots are never consumed", async () => {
  const lots = [lot("lot-old", 1000, "2025-06-30T00:00:00Z"), lot("lot-new", 300, "2026-12-31T00:00:00Z")];
  const { router } = app([pendingOrder()], lots);
  const res = await redeem(router, "o1", { points: 500, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal((res.body as { error_code: string }).error_code, "INSUFFICIENT_POINTS");
});

test("LOY-002: excess points beyond the amount are not applied or consumed", async () => {
  const order = pendingOrder({ lines: [{ sku: "small", unitPriceCents: 1000, quantity: 1 }] });
  const { router, loyalty } = app([order], [lot("lot-x", 9000, "2026-12-31T00:00:00Z")]);
  const res = await redeem(router, "o1", { points: 5000, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 1000, discountCents: 0, pointsCents: 1000, taxCents: 0, totalCents: 0 });
  assert.equal((await loyalty.getLot("lot-x"))!.points, 8000);
});

test("LOY-002: same key replays the stored result without consuming again", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("lot-x", 1500, "2026-12-31T00:00:00Z")]);
  const first = await redeem(router, "o1", { points: 1000, idempotencyKey: "k1" });
  const second = await redeem(router, "o1", { points: 1000, idempotencyKey: "k1" });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal((await loyalty.getLot("lot-x"))!.points, 500);
});

test("LOY-002: same key with a different body is rejected and changes nothing", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("lot-x", 1500, "2026-12-31T00:00:00Z")]);
  await redeem(router, "o1", { points: 1000, idempotencyKey: "k1" });
  const res = await redeem(router, "o1", { points: 200, idempotencyKey: "k1" });
  assert.equal(res.status, 422);
  assert.equal((await loyalty.getLot("lot-x"))!.points, 500);
});

test("LOY-002: a different customer's identical key is unrelated", async () => {
  const { router, loyalty } = app(
    [pendingOrder(), pendingOrder({ id: "o3", customerId: "bob", region: "FR" })],
    [lot("lot-a", 1000, "2026-12-31T00:00:00Z"), lot("lot-b", 1000, "2026-12-31T00:00:00Z", "bob")],
  );
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "same" })).status, 200);
  assert.equal((await redeem(router, "o3", { points: 100, idempotencyKey: "same" }, asBob)).status, 200);
  assert.equal((await loyalty.getLot("lot-b"))!.points, 900);
});

test("LOY-002: concurrent redemptions for one customer never spend the same points", async () => {
  const orders = ["o1", "o2", "o3", "o4"].map(id => pendingOrder({ id }));
  const { router, loyalty } = app(orders, [lot("lot-x", 1000, "2026-12-31T00:00:00Z")]);
  const results = await Promise.all(orders.map((o, i) => redeem(router, o.id, { points: 300, idempotencyKey: "k" + i })));
  const accepted = results.filter(r => r.status === 200).length;
  assert.equal(accepted, 3);
  assert.equal((await loyalty.getLot("lot-x"))!.points, 1000 - 300 * accepted);
});

test("LOY-002: a shipped order cannot be paid with points", async () => {
  const { router, loyalty } = app([pendingOrder({ status: "shipped" })], [lot("lot-x", 1000, "2026-12-31T00:00:00Z")]);
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal((await loyalty.getLot("lot-x"))!.points, 1000);
});

test("LOY-002: another customer's order is not found", async () => {
  const { router } = app([pendingOrder()], [lot("lot-x", 1000, "2026-12-31T00:00:00Z")]);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k1" }, asBob)).status, 404);
});

test("LOY-002: invalid bodies are rejected", async () => {
  const { router } = app([pendingOrder()], [lot("lot-x", 1000, "2026-12-31T00:00:00Z")]);
  assert.equal((await redeem(router, "o1", { points: 0, idempotencyKey: "k1" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 1.5, idempotencyKey: "k1" })).status, 400);
  assert.equal((await redeem(router, "o1", { points: 100 })).status, 400);
});

test("LOY-002: cancelling a redeemed order restores points to their original lots and expiry", async () => {
  const lots = [lot("lot-late", 300, "2026-12-31T00:00:00Z"), lot("lot-early", 500, "2026-12-01T00:00:00Z")];
  const { router, loyalty } = app([pendingOrder()], lots);
  await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  const res = await cancel(router, "o1");
  assert.equal(res.status, 200);
  const early = (await loyalty.getLot("lot-early"))!;
  const late = (await loyalty.getLot("lot-late"))!;
  assert.equal(early.points, 500);
  assert.equal(early.expiresAt.toISOString(), "2026-12-01T00:00:00.000Z");
  assert.equal(late.points, 300);
  assert.equal(late.expiresAt.toISOString(), "2026-12-31T00:00:00.000Z");
});

test("LOY-002: points whose lot expired before cancellation are forfeited", async () => {
  const time = clock("2026-11-19T12:00:00Z");
  const lots = [lot("lot-early", 500, "2026-12-01T00:00:00Z"), lot("lot-late", 300, "2026-12-31T00:00:00Z")];
  const { router, loyalty } = app([pendingOrder()], lots, time.now);
  await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  time.set("2026-12-15T00:00:00Z");
  assert.equal((await cancel(router, "o1")).status, 200);
  assert.equal((await loyalty.getLot("lot-early"))!.points, 0);
  assert.equal((await loyalty.getLot("lot-late"))!.points, 300);
});

test("LOY-002: a cancelled order's redemption is reversed only once", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("lot-x", 1000, "2026-12-31T00:00:00Z")]);
  await redeem(router, "o1", { points: 400, idempotencyKey: "k1" });
  await cancel(router, "o1");
  assert.equal((await cancel(router, "o1")).status, 409);
  assert.equal((await loyalty.getLot("lot-x"))!.points, 1000);
});

test("LOY-002: an order with a redemption cannot be redeemed again under a new key", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("lot-x", 1000, "2026-12-31T00:00:00Z")]);
  await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k2" });
  assert.equal(res.status, 409);
  assert.equal((await loyalty.getLot("lot-x"))!.points, 900);
});
