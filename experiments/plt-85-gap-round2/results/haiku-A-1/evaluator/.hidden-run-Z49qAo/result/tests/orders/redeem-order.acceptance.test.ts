/**
 * Acceptance LOY-002
 * POST /orders/:id/redeem pays part of a pending order with points. Points are taken from
 * non-expired lots, earliest expiry first, 100 points = 1 EUR, applied after discounts and before
 * tax, never below zero. Idempotent per key. Cancelling returns points to their original lots.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Router } from "../../src/http/router.ts";
import type { InMemoryLoyaltyStore } from "../../src/loyalty/integration/loyalty-store.ts";
import { app, asAlice, asBob, pendingOrder } from "./helpers.ts";
import { seedLots } from "../../src/seed.ts";

// Alice's lots from seed: a1 300 pts (exp 2026-12-31), a2 500 pts (exp 2026-12-01), a3 1000 pts (expired 2025).
const NOW = new Date("2026-11-19T12:00:00Z");

const redeem = (router: Router, orderId: string, body: unknown, headers = asAlice) =>
  router.handle({ method: "POST", path: `/orders/${orderId}/redeem`, headers, body });
const cancel = (router: Router, orderId: string) =>
  router.handle({ method: "POST", path: `/orders/${orderId}/cancel`, headers: asAlice });
const balance = async (loyalty: InMemoryLoyaltyStore, id: string) => (await loyalty.getLot(id))!.points;

test("LOY-002: points are taken earliest-expiry first and priced after discount, before tax", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots, () => NOW);
  // subtotal 10000, SAVE10 -1000 => payable 9000; 600 points => 9000-600 = 8400 taxed at 19% = 1596
  const res = await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 10000, discountCents: 1000, pointsAppliedCents: 600, taxCents: 1596, totalCents: 9996,
  });
  assert.equal(await balance(loyalty, "lot-a2"), 0);   // expires first: fully used
  assert.equal(await balance(loyalty, "lot-a1"), 200); // then the next lot
  assert.equal(await balance(loyalty, "lot-a3"), 1000); // expired: untouched
});

test("LOY-002: excess points are not consumed and the amount never goes below zero", async () => {
  const { router, loyalty } = app([pendingOrder({ lines: [{ sku: "x", unitPriceCents: 700, quantity: 1 }] })],
    seedLots, () => NOW);
  const res = await redeem(router, "o1", { points: 5000, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 700, discountCents: 0, pointsAppliedCents: 700, taxCents: 0, totalCents: 0,
  });
  assert.equal(await balance(loyalty, "lot-a2"), 0);
  assert.equal(await balance(loyalty, "lot-a1"), 100); // only 700 of the 800 usable points were spent
});

test("LOY-002: a replayed key returns the same result and consumes nothing more", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots, () => NOW);
  const first = await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  const again = await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body);
  assert.equal(await balance(loyalty, "lot-a1"), 200);
  assert.equal(await balance(loyalty, "lot-a2"), 0);
});

test("LOY-002: a reused key with a different body is rejected and consumes nothing", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots, () => NOW);
  await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  const res = await redeem(router, "o1", { points: 700, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal(await balance(loyalty, "lot-a1"), 200);
});

test("LOY-002: concurrent redemptions for one customer never spend the same points", async () => {
  // Alice holds 800 usable points. Two different orders each ask for 500 at the same time.
  const { router, loyalty } = app([pendingOrder({ id: "o1" }), pendingOrder({ id: "o4" })], seedLots, () => NOW);
  const [r1, r2] = await Promise.all([
    redeem(router, "o1", { points: 500, idempotencyKey: "k1" }),
    redeem(router, "o4", { points: 500, idempotencyKey: "k2" }),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const applied = (r1.body as { pointsAppliedCents: number }).pointsAppliedCents
    + (r2.body as { pointsAppliedCents: number }).pointsAppliedCents;
  assert.equal(applied, 800);
  assert.equal(await balance(loyalty, "lot-a1") + await balance(loyalty, "lot-a2"), 0);
});

test("LOY-002: concurrent requests with the same key consume once and agree", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots, () => NOW);
  const [r1, r2] = await Promise.all([
    redeem(router, "o1", { points: 600, idempotencyKey: "k1" }),
    redeem(router, "o1", { points: 600, idempotencyKey: "k1" }),
  ]);
  assert.deepEqual(r1.body, r2.body);
  assert.equal(await balance(loyalty, "lot-a1") + await balance(loyalty, "lot-a2"), 800 - 600);
});

test("LOY-002: cancelling returns points to their original lots with original expiry", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots, () => NOW);
  await redeem(router, "o1", { points: 600, idempotencyKey: "k1" });
  const res = await cancel(router, "o1");
  assert.equal(res.status, 200);
  assert.equal(await balance(loyalty, "lot-a2"), 500);
  assert.equal(await balance(loyalty, "lot-a1"), 300);
  assert.equal((await loyalty.getLot("lot-a1"))!.expiresAt.toISOString(), "2026-12-31T00:00:00.000Z");
});

test("LOY-002: points whose lot expired before cancellation are forfeited", async () => {
  let clock = NOW;
  const { router, loyalty } = app([pendingOrder()], seedLots, () => clock);
  await redeem(router, "o1", { points: 600, idempotencyKey: "k1" }); // a2 500 + a1 100
  clock = new Date("2026-12-15T00:00:00Z"); // lot-a2 (exp 2026-12-01) has expired; lot-a1 has not
  assert.equal((await cancel(router, "o1")).status, 200);
  assert.equal(await balance(loyalty, "lot-a2"), 0);   // forfeited
  assert.equal(await balance(loyalty, "lot-a1"), 300); // 200 left + 100 returned
});

test("LOY-002: a shipped order cannot be redeemed against", async () => {
  const { router, loyalty } = app([pendingOrder({ status: "shipped" })], seedLots, () => NOW);
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal(await balance(loyalty, "lot-a2"), 500);
});

test("LOY-002: another customer's order is not found", async () => {
  const { router } = app([pendingOrder()], seedLots, () => NOW);
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" }, asBob);
  assert.equal(res.status, 404);
});

test("LOY-002: an order takes at most one points redemption", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots, () => NOW);
  await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k2" });
  assert.equal(res.status, 409);
  assert.equal(await balance(loyalty, "lot-a2"), 400);
});

test("LOY-002: no usable points means nothing is recorded", async () => {
  const { router } = app([pendingOrder()], [seedLots[2]!], () => NOW); // only the expired lot
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
});

test("LOY-002: invalid bodies are rejected", async () => {
  const { router } = app([pendingOrder()], seedLots, () => NOW);
  for (const body of [{ points: 0, idempotencyKey: "k" }, { points: -5, idempotencyKey: "k" },
    { points: 1.5, idempotencyKey: "k" }, { points: "100", idempotencyKey: "k" }, { points: 100 }, { points: 100, idempotencyKey: "" }]) {
    assert.equal((await redeem(router, "o1", body)).status, 400, JSON.stringify(body));
  }
});
