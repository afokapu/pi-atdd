/**
 * Acceptance LOY-002
 * Given the signed-in owner of a pending order
 * When the customer sends POST /orders/:id/redeem with { points, idempotencyKey }
 * Then points are consumed from non-expired lots earliest expiry first,
 * applied to the quote after discounts and before tax (never below zero,
 * surplus not consumed), the same key replays the same result, concurrent
 * redemptions for one customer never spend the same points, and cancelling
 * the order returns the points to their original lots (expired lots forfeit).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "./helpers.ts";
import type { RedeemQuote } from "../../src/orders/application/redeem-order.ts";
import type { Response } from "../../src/http/router.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

/** Alice's lots: two usable (earliest first) and one already expired. */
const aliceLots = (): PointsLot[] => [
  { id: "lot-a2", customerId: "alice", points: 500, expiresAt: new Date("2026-12-01T00:00:00Z") },
  { id: "lot-a1", customerId: "alice", points: 300, expiresAt: new Date("2026-12-31T00:00:00Z") },
  { id: "lot-a3", customerId: "alice", points: 1000, expiresAt: new Date("2025-06-30T00:00:00Z") },
];

const redeem = (router: ReturnType<typeof app>["router"], id: string, body: unknown, headers = asAlice): Promise<Response> =>
  router.handle({ method: "POST", path: `/orders/${id}/redeem`, headers, body });

const bodyOf = (res: Response): RedeemQuote => res.body as RedeemQuote;

test("LOY-002: points apply after discount and before tax", async () => {
  const { router } = app([pendingOrder({ discountCode: "SAVE10" })], aliceLots());
  const res = await redeem(router, "o1", { points: 400, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  // discount 1000, points 400 -> tax on 8600 at 19% = 1634 (not on 9600 = 1824)
  assert.deepEqual(bodyOf(res), {
    subtotalCents: 10000, discountCents: 1000, pointsCents: 400, taxCents: 1634, totalCents: 10234,
  });
});

test("LOY-002: earliest-expiring lot is consumed first; expired lots are skipped", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 400); // expires 2026-12-01, drawn first
  assert.equal((await loyalty.getLot("lot-a1"))!.points, 300); // expires later, untouched
  assert.equal((await loyalty.getLot("lot-a3"))!.points, 1000); // expired 2025-06-30, skipped
});

test("LOY-002: points never push the amount below zero; surplus points are not consumed", async () => {
  const order = pendingOrder({ lines: [{ sku: "sku-1", unitPriceCents: 500, quantity: 1 }] }); // due 500
  const { router, loyalty } = app([order], aliceLots());
  const res = await redeem(router, "o1", { points: 5000, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  assert.deepEqual(bodyOf(res), { subtotalCents: 500, discountCents: 0, pointsCents: 500, taxCents: 0, totalCents: 0 });
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 0); // exactly 500 consumed...
  assert.equal((await loyalty.getLot("lot-a1"))!.points, 300); // ...no more
});

test("LOY-002: fewer points available than requested consumes all usable points", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  const res = await redeem(router, "o1", { points: 2000, idempotencyKey: "k1" });
  assert.equal(res.status, 200);
  // 800 points applied: tax on 9200 at 19% = 1748, total 10948
  assert.deepEqual(bodyOf(res), { subtotalCents: 10000, discountCents: 0, pointsCents: 800, taxCents: 1748, totalCents: 10948 });
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 0);
  assert.equal((await loyalty.getLot("lot-a1"))!.points, 0);
  assert.equal((await loyalty.getLot("lot-a3"))!.points, 1000);
});

test("LOY-002: same key replays the stored result and consumes nothing more", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  const first = await redeem(router, "o1", { points: 400, idempotencyKey: "k1" });
  const replay = await redeem(router, "o1", { points: 400, idempotencyKey: "k1" });
  assert.equal(first.status, 200);
  assert.deepEqual(replay.status, first.status);
  assert.deepEqual(bodyOf(replay), bodyOf(first));
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 100); // consumed once, not twice
});

test("LOY-002: same key with a different body is rejected", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  await redeem(router, "o1", { points: 400, idempotencyKey: "k1" });
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  assert.equal(res.status, 409);
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 100); // nothing further consumed
});

test("LOY-002: replay returns the stored original result after the order changed", async () => {
  const { router, orders } = app([pendingOrder()], aliceLots());
  const first = await redeem(router, "o1", { points: 400, idempotencyKey: "k1" });
  const order = orders.get("o1")!;
  orders.save({ ...order, lines: [{ sku: "sku-1", unitPriceCents: 99999, quantity: 9 }] });
  const replay = await redeem(router, "o1", { points: 400, idempotencyKey: "k1" });
  assert.deepEqual(bodyOf(replay), bodyOf(first)); // stored result, not recomputed
});

test("LOY-002: the same key on a different order is an independent scope", async () => {
  const { router, loyalty } = app([pendingOrder(), pendingOrder({ id: "o2" })], aliceLots());
  const r1 = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" });
  const r2 = await redeem(router, "o2", { points: 100, idempotencyKey: "k1" });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 300); // both consumed
});

test("LOY-002: redeeming requires authentication and ownership", async () => {
  const { router } = app([pendingOrder()], aliceLots());
  const anon = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" }, {});
  assert.equal(anon.status, 401);
  const foreign = await redeem(router, "o1", { points: 100, idempotencyKey: "k1" }, asBob);
  assert.equal(foreign.status, 404);
});

test("LOY-002: another customer redeems from their own lots", async () => {
  const bobLots: PointsLot[] = [{ id: "lot-b1", customerId: "bob", points: 250, expiresAt: new Date("2027-03-31T00:00:00Z") }];
  const { router } = app([pendingOrder({ customerId: "bob", region: "FR", discountCode: "FLAT5",
    lines: [{ sku: "mug", unitPriceCents: 1250, quantity: 4 }] })], bobLots);
  const res = await redeem(router, "o1", { points: 500, idempotencyKey: "kb" }, asBob);
  assert.equal(res.status, 200);
  // subtotal 5000, FLAT5 500, points 250 -> tax on 4250 at 20% = 850
  assert.deepEqual(bodyOf(res), { subtotalCents: 5000, discountCents: 500, pointsCents: 250, taxCents: 850, totalCents: 5100 });
});

test("LOY-002: invalid bodies are rejected with 400", async () => {
  const { router } = app([pendingOrder()], aliceLots());
  for (const body of [undefined, {}, { points: 0, idempotencyKey: "k" }, { points: -5, idempotencyKey: "k" },
    { points: 2.5, idempotencyKey: "k" }, { points: "10", idempotencyKey: "k" }, { points: 10 }]) {
    const res = await redeem(router, "o1", body);
    assert.equal(res.status, 400, `body ${JSON.stringify(body)} should be rejected`);
  }
});

test("LOY-002: only pending orders can be redeemed", async () => {
  const { router } = app([pendingOrder({ status: "shipped" })], aliceLots());
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k1" })).status, 409);
  const { router: r2, loyalty } = app([pendingOrder()], aliceLots());
  await redeem(r2, "o1", { points: 100, idempotencyKey: "k1" });
  await r2.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal((await redeem(r2, "o1", { points: 100, idempotencyKey: "k2" })).status, 409);
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 500); // k1's points were restored by the cancel
});

test("LOY-002: a second redemption of the same order is rejected", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k1" })).status, 200);
  const res = await redeem(router, "o1", { points: 100, idempotencyKey: "k2" });
  assert.equal(res.status, 409);
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 400); // consumed once only
});

test("LOY-002: concurrent redemptions for one customer never spend the same points", async () => {
  const { router, loyalty } = app([pendingOrder(), pendingOrder({ id: "o2", lines: [{ sku: "s", unitPriceCents: 2500, quantity: 4 }] })], aliceLots());
  const [r1, r2] = await Promise.all([
    redeem(router, "o1", { points: 500, idempotencyKey: "k1" }),
    redeem(router, "o2", { points: 500, idempotencyKey: "k2" }),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const a1 = (await loyalty.getLot("lot-a1"))!.points, a2 = (await loyalty.getLot("lot-a2"))!.points;
  assert.ok(a1 >= 0 && a2 >= 0, "no lot went negative");
  const removed = (300 - a1) + (500 - a2); // per-lot consumption from the seeded balances
  assert.equal(removed, bodyOf(r1).pointsCents + bodyOf(r2).pointsCents);
  assert.ok(removed <= 800, "at most the available points were spent");
});

test("LOY-002: concurrent retries with one key cause a single side effect", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  const results = await Promise.all([
    redeem(router, "o1", { points: 400, idempotencyKey: "k1" }),
    redeem(router, "o1", { points: 400, idempotencyKey: "k1" }),
    redeem(router, "o1", { points: 400, idempotencyKey: "k1" }),
  ]);
  for (const r of results) {
    assert.equal(r.status, 200);
    assert.deepEqual(bodyOf(r), bodyOf(results[0]!));
  }
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 100); // consumed exactly once
});

test("LOY-002: concurrent redemptions of one order with different keys elect one winner", async () => {
  const { router, loyalty } = app([pendingOrder()], aliceLots());
  const results = await Promise.all([
    redeem(router, "o1", { points: 400, idempotencyKey: "k1" }),
    redeem(router, "o1", { points: 400, idempotencyKey: "k2" }),
    redeem(router, "o1", { points: 400, idempotencyKey: "k3" }),
  ]);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 100); // one consumption only
});

test("LOY-002: cancelling a redeemed order returns points to their original lots", async () => {
  const { router, loyalty, orders } = app([pendingOrder()], aliceLots());
  await redeem(router, "o1", { points: 400, idempotencyKey: "k1" });
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal(orders.get("o1")!.status, "cancelled");
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 500); // original lot, original expiry
  assert.equal((await loyalty.getLot("lot-a1"))!.points, 300);
  assert.equal((await redeem(router, "o1", { points: 100, idempotencyKey: "k2" })).status, 409);
});

test("LOY-002: cancelling after a lot expired forfeits that lot's points only", async () => {
  let clock = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty, orders } = app([pendingOrder()], aliceLots(), () => clock);
  await redeem(router, "o1", { points: 700, idempotencyKey: "k1" }); // lot-a2 500, lot-a1 200
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 0);
  assert.equal((await loyalty.getLot("lot-a1"))!.points, 100);
  clock = new Date("2026-12-15T12:00:00Z"); // lot-a2 (2026-12-01) now expired, lot-a1 not
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal(orders.get("o1")!.status, "cancelled");
  assert.equal((await loyalty.getLot("lot-a2"))!.points, 0); // 500 points forfeited
  assert.equal((await loyalty.getLot("lot-a1"))!.points, 300); // restored to original lot
});
