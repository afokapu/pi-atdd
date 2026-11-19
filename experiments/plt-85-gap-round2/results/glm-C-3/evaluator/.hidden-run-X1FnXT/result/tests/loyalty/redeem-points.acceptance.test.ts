/**
 * Acceptance LOY-REDEEM-001 / LOY-REDEEM-002
 * Given a pending order owned by the signed-in customer and points held in lots
 * When the customer sends POST /orders/:id/redeem { points, idempotencyKey }
 * Then points are consumed earliest-expiry-first from non-expired lots, the
 *      quote shows points applied after discount and before tax (never below
 *      zero, excess not consumed), the same key replays the stored result, a
 *      different payload with the same key is rejected, and concurrent
 *      redemptions of one customer never spend the same points.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "../orders/helpers.ts";
import type { Router } from "../../src/http/router.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

/** Alice's lots: l1 expires first, l2 later. Valid at the fixed test clock (2026-11-19). */
const aliceLots = (): PointsLot[] => [
  { id: "l1", customerId: "alice", points: 500, expiresAt: new Date("2026-12-01T00:00:00Z") },
  { id: "l2", customerId: "alice", points: 300, expiresAt: new Date("2027-01-31T00:00:00Z") },
];

const redeem = (router: Router, body: unknown, headers = asAlice, id = "o1") =>
  router.handle({ method: "POST", path: `/orders/${id}/redeem`, headers, body });

test("LOY-REDEEM-001: points apply after discount and before tax, earliest expiry first", async () => {
  const order = pendingOrder({ discountCode: "SAVE10" }); // subtotal 10000, discount 1000
  const { router, loyalty } = app([order], aliceLots());
  const res = await redeem(router, { points: 400, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  // 10000 - 1000 discount - 400 points = 8600 taxable; tax = round(8600 * 0.19) = 1634
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 1000,
    pointsAppliedCents: 400, taxCents: 1634, totalCents: 10234 });
  assert.equal((await loyalty.getLot("l1"))!.points, 100); // earliest expiry drained first
  assert.equal((await loyalty.getLot("l2"))!.points, 300); // untouched
});

test("LOY-REDEEM-001: consumption spills into later-expiring lots", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  const res = await redeem(router, { points: 600, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.equal((res.body as { pointsAppliedCents: number }).pointsAppliedCents, 600);
  assert.equal((await loyalty.getLot("l1"))!.points, 0);
  assert.equal((await loyalty.getLot("l2"))!.points, 200);
});

test("LOY-REDEEM-001: excess points are not consumed", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  const res = await redeem(router, { points: 20000, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  // Only the 800 available points apply: 10000 - 800 = 9200 taxable, tax 1748, total 10948.
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 0,
    pointsAppliedCents: 800, taxCents: 1748, totalCents: 10948 });
  assert.equal((await loyalty.getLot("l1"))!.points, 0);
  assert.equal((await loyalty.getLot("l2"))!.points, 0);
});

test("LOY-REDEEM-001: payable amount never drops below zero (points capped at payable)", async () => {
  // subtotal 700, FLAT5 discount 500 -> payable 200, US has no tax.
  const order = pendingOrder({ region: "US", lines: [{ sku: "s", unitPriceCents: 700, quantity: 1 }], discountCode: "FLAT5" });
  const { router, loyalty } = app([order], [{ id: "l1", customerId: "alice", points: 250, expiresAt: new Date("2027-06-30T00:00:00Z") }]);
  const res = await redeem(router, { points: 500, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "US", subtotalCents: 700, discountCents: 500,
    pointsAppliedCents: 200, taxCents: 0, totalCents: 0 });
  assert.equal((await loyalty.getLot("l1"))!.points, 50); // only 200 of the 500 requested consumed
});

test("LOY-REDEEM-001: expired lots are skipped", async () => {
  const expired = { id: "l0", customerId: "alice", points: 999, expiresAt: new Date("2025-06-30T00:00:00Z") };
  const { router, loyalty } = app([pendingOrder()], [expired, ...aliceLots()]);
  const res = await redeem(router, { points: 100, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.equal((await loyalty.getLot("l0"))!.points, 999); // expired: untouched
  assert.equal((await loyalty.getLot("l1"))!.points, 400);
});

test("LOY-REDEEM-001: same key replays the stored result, nothing more consumed", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  const first = await redeem(router, { points: 400, idempotencyKey: "k1" });
  const replay = await redeem(router, { points: 400, idempotencyKey: "k1" });
  assert.equal(replay.status, first.status);
  assert.deepEqual(replay.body, first.body);
  assert.equal((await loyalty.getLot("l1"))!.points, 100); // consumed exactly once
});

test("LOY-REDEEM-001: same key with a different payload is rejected, state unchanged", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  await redeem(router, { points: 400, idempotencyKey: "k1" });
  const res = await redeem(router, { points: 401, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal((await loyalty.getLot("l1"))!.points, 100); // no further consumption
  assert.equal((await loyalty.getLot("l2"))!.points, 300);
});

test("LOY-REDEEM-001: idempotency keys are scoped per customer", async () => {
  const bobOrder = pendingOrder({ id: "o3", customerId: "bob", region: "FR", discountCode: "FLAT5",
    lines: [{ sku: "mug", unitPriceCents: 1250, quantity: 4 }] });
  const { router, loyalty } = app([pendingOrder(), bobOrder], [
    ...aliceLots(),
    { id: "b1", customerId: "bob", points: 250, expiresAt: new Date("2027-03-31T00:00:00Z") },
  ]);
  await redeem(router, { points: 400, idempotencyKey: "shared" }); // alice, her key
  const bobRes = await redeem(router, { points: 100, idempotencyKey: "shared" }, asBob, "o3");
  assert.equal(bobRes.status, 200); // bob's first use of "shared" is independent
  assert.equal((await loyalty.getLot("b1"))!.points, 150);
  const aliceReplay = await redeem(router, { points: 400, idempotencyKey: "shared" });
  assert.equal((aliceReplay.body as { pointsAppliedCents: number }).pointsAppliedCents, 400); // alice's record intact
});

test("LOY-REDEEM-001: authentication, ownership and order state are enforced", async () => {
  const { router } = app([pendingOrder({ status: "shipped" }), pendingOrder({ id: "o2b", customerId: "bob" })], aliceLots());
  assert.equal((await redeem(router, { points: 100, idempotencyKey: "k" }, { authorization: "Bearer nope" })).status, 401);
  assert.equal((await redeem(router, { points: 100, idempotencyKey: "k" }, asBob, "o1")).status, 404);
  assert.equal((await redeem(router, { points: 100, idempotencyKey: "k" })).status, 409); // shipped
});

test("LOY-REDEEM-001: invalid bodies are rejected without consuming points", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  for (const body of [{ points: 0, idempotencyKey: "k" }, { points: 1.5, idempotencyKey: "k" }, { points: -3, idempotencyKey: "k" },
    { points: 100 }, { idempotencyKey: "k" }, { points: 100, idempotencyKey: "" }]) {
    assert.equal((await redeem(router, body)).status, 400, `body ${JSON.stringify(body)}`);
  }
  assert.equal((await loyalty.getLot("l1"))!.points, 500); // nothing consumed
});

test("LOY-REDEEM-002: concurrent redemptions of one customer never spend the same points", async () => {
  const { router, loyalty } = app([pendingOrder()], [
    { id: "l1", customerId: "alice", points: 400, expiresAt: new Date("2026-12-01T00:00:00Z") },
    { id: "l2", customerId: "alice", points: 400, expiresAt: new Date("2027-01-01T00:00:00Z") },
  ]);
  const redeemAs = (key: string) => redeem(router, { points: 300, idempotencyKey: key });
  const results = await Promise.all([redeemAs("k1"), redeemAs("k2"), redeemAs("k3")]);
  assert.ok(results.every(r => r.status === 200));
  const applied = results.map(r => (r.body as { pointsAppliedCents: number }).pointsAppliedCents);
  assert.deepEqual([...applied].sort((a, b) => b - a), [300, 300, 200]); // serialised, last gets the remainder
  assert.equal(applied.reduce((sum, n) => sum + n, 0), 800); // total applied == total removed
  assert.equal((await loyalty.getLot("l1"))!.points, 0); // no lot went negative or was double-spent
  assert.equal((await loyalty.getLot("l2"))!.points, 0);
});
