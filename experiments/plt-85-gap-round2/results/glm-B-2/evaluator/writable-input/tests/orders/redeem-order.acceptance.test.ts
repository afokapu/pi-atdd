/**
 * Acceptance LOY-REDEEM-001
 * Given a pending order owned by the signed-in customer with spendable point lots
 * When the customer sends POST /orders/:id/redeem with { points, idempotencyKey }
 * Then points are consumed earliest-expiry-first from non-expired lots, the
 * quote shows points applied after discount and before tax (never below zero,
 * excess not consumed), the same key replays the same result, and concurrent
 * redemptions of one customer never spend the same points.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "./helpers.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const redeem = (router: ReturnType<typeof app>["router"], key: string, points: number, headers = asAlice) =>
  router.handle({ method: "POST", path: "/orders/o1/redeem", headers, body: { points, idempotencyKey: key } });

/** Alice's two valid lots: "early" expires first and must be drained first. */
const twoLots = (): PointsLot[] => [
  { id: "lot-early", customerId: "alice", points: 300, expiresAt: new Date("2026-12-01T00:00:00Z") },
  { id: "lot-late", customerId: "alice", points: 300, expiresAt: new Date("2027-06-01T00:00:00Z") },
];

test("LOY-REDEEM-001: redeem consumes the earliest-expiring lot first and returns the new quote", async () => {
  const { router, loyalty } = app([pendingOrder()], twoLots()); // subtotal 10000, no discount
  const res = await redeem(router, "k1", 250);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 10000, discountCents: 0, pointsCents: 250, taxCents: 1853, totalCents: 11603,
  });
  assert.equal((await loyalty.getLot("lot-early"))!.points, 50); // 250 taken from the earlier expiry
  assert.equal((await loyalty.getLot("lot-late"))!.points, 300);
});

test("LOY-REDEEM-001: a redemption spanning several lots drains them in expiry order", async () => {
  const { router, loyalty } = app([pendingOrder()], twoLots());
  const res = await redeem(router, "k1", 400);
  assert.equal(res.status, 200);
  assert.equal((res.body as { pointsCents: number }).pointsCents, 400);
  assert.equal((await loyalty.getLot("lot-early"))!.points, 0);
  assert.equal((await loyalty.getLot("lot-late"))!.points, 200);
});

test("LOY-REDEEM-001: expired lots are never consumed and the balance caps the redemption", async () => {
  const lots: PointsLot[] = [
    { id: "lot-expired", customerId: "alice", points: 1000, expiresAt: new Date("2025-06-30T00:00:00Z") },
    { id: "lot-live", customerId: "alice", points: 100, expiresAt: new Date("2027-06-01T00:00:00Z") },
  ];
  const { router, loyalty } = app([pendingOrder()], lots);
  const res = await redeem(router, "k1", 300);
  assert.equal(res.status, 200);
  // Only the 100 spendable points are consumed (1 point = 1 cent); the expired lot stays untouched.
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 10000, discountCents: 0, pointsCents: 100, taxCents: 1881, totalCents: 11781,
  });
  assert.equal((await loyalty.getLot("lot-expired"))!.points, 1000);
  assert.equal((await loyalty.getLot("lot-live"))!.points, 0);
});

test("LOY-REDEEM-001: points never push the amount below zero and excess points are not consumed", async () => {
  // subtotal 2000, FLAT5 discount 500 -> 1500 due after discount, before tax
  const order = pendingOrder({ discountCode: "FLAT5", lines: [{ sku: "mug", unitPriceCents: 2000, quantity: 1 }] });
  const lots: PointsLot[] = [
    { id: "lot-big", customerId: "alice", points: 2000, expiresAt: new Date("2027-06-01T00:00:00Z") },
  ];
  const { router, loyalty } = app([order], lots);
  const res = await redeem(router, "k1", 2000);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 2000, discountCents: 500, pointsCents: 1500, taxCents: 0, totalCents: 0,
  });
  assert.equal((await loyalty.getLot("lot-big"))!.points, 500); // only 1500 of the 2000 requested
});

test("LOY-REDEEM-001: the same key replays the same result and consumes nothing more", async () => {
  const { router, loyalty } = app([pendingOrder()], twoLots());
  const first = await redeem(router, "k1", 100);
  const second = await redeem(router, "k1", 100);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal((await loyalty.getLot("lot-early"))!.points, 200); // consumed exactly once
});

test("LOY-REDEEM-001: the same key with a different body is rejected", async () => {
  const { router, loyalty } = app([pendingOrder()], twoLots());
  assert.equal((await redeem(router, "k1", 100)).status, 200);
  const clash = await redeem(router, "k1", 500);
  assert.equal(clash.status, 409);
  assert.equal((await loyalty.getLot("lot-early"))!.points, 200); // nothing further consumed
});

test("LOY-REDEEM-001: another customer's order is not found", async () => {
  const { router } = app([pendingOrder()], twoLots());
  const res = await redeem(router, "k1", 100, asBob);
  assert.equal(res.status, 404);
});

test("LOY-REDEEM-001: only pending orders can be redeemed", async () => {
  const { router } = app([pendingOrder({ status: "shipped" })], twoLots());
  const res = await redeem(router, "k1", 100);
  assert.equal(res.status, 409);
});

test("LOY-REDEEM-001: invalid bodies are rejected with 400", async () => {
  const { router } = app([pendingOrder()], twoLots());
  for (const body of [
    { points: 0, idempotencyKey: "k" },
    { points: 2.5, idempotencyKey: "k" },
    { points: "5", idempotencyKey: "k" },
    { points: 5 },
    { points: 5, idempotencyKey: "" },
  ]) {
    const res = await router.handle({ method: "POST", path: "/orders/o1/redeem", headers: asAlice, body });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
});

test("LOY-REDEEM-001: concurrent redemptions never spend the same points", async () => {
  const lots: PointsLot[] = [
    { id: "lot-x", customerId: "alice", points: 300, expiresAt: new Date("2027-06-01T00:00:00Z") },
  ];
  const { router, loyalty } = app([pendingOrder()], lots);
  const [r1, r2] = await Promise.all([redeem(router, "k-a", 200), redeem(router, "k-b", 200)]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  // The balance is 300: whichever request lands first takes 200, the other only 100.
  const applied = [(r1.body as { pointsCents: number }).pointsCents, (r2.body as { pointsCents: number }).pointsCents]
    .sort((a, b) => b - a);
  assert.deepEqual(applied, [200, 100]);
  assert.equal((await loyalty.getLot("lot-x"))!.points, 0); // no double spend
});

test("LOY-REDEEM-001: a concurrent double-submit with the same key is applied once", async () => {
  const lots: PointsLot[] = [
    { id: "lot-x", customerId: "alice", points: 300, expiresAt: new Date("2027-06-01T00:00:00Z") },
  ];
  const { router, loyalty } = app([pendingOrder()], lots);
  const [r1, r2] = await Promise.all([redeem(router, "dup", 100), redeem(router, "dup", 100)]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.body, r1.body);
  assert.equal((await loyalty.getLot("lot-x"))!.points, 200); // exactly one consumption of 100
});
