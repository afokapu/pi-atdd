/**
 * Acceptance LOY-002
 * POST /orders/:id/redeem lets the signed-in owner of a pending order pay part
 * of it with loyalty points: lots are consumed non-expired, earliest expiry
 * first; points reduce the amount after discounts and before tax (100 points =
 * EUR 1, integer cents, never below zero, excess not consumed); a repeated
 * idempotency key replays the same result, a repeated key with a different
 * body is rejected; concurrent redemptions for one customer never spend the
 * same points; cancelling a redeemed order returns points to their original
 * lots with the original expiry (expired lots' points are forfeited).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "../orders/helpers.ts";
import type { RedeemedQuote } from "../../src/pricing/domain/quote.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

type TestApp = ReturnType<typeof app>;

const redeem = (router: TestApp["router"], id: string, body: unknown, headers = asAlice) =>
  router.handle({ method: "POST", path: `/orders/${id}/redeem`, headers, body });

/** Alice's seeded lots: a1 300pts exp 2026-12-31, a2 500pts exp 2026-12-01, a3 1000pts exp 2025-06-30 (expired). */
const aliceLots = (): PointsLot[] => [
  { id: "lot-a1", customerId: "alice", points: 300, expiresAt: new Date("2026-12-31T00:00:00Z") },
  { id: "lot-a2", customerId: "alice", points: 500, expiresAt: new Date("2026-12-01T00:00:00Z") },
  { id: "lot-a3", customerId: "alice", points: 1000, expiresAt: new Date("2025-06-30T00:00:00Z") },
];

const lotPoints = async (a: TestApp, lotId: string) =>
  (await a.loyalty.getLot(lotId))!.points;

test("LOY-002: redeems points after discount, before tax, earliest expiry first", async () => {
  const a = app([pendingOrder({ discountCode: "SAVE10" })], aliceLots());
  // order o1: subtotal 10000, SAVE10 -> 1000 off, payable 9000; 400 points -> taxable 8600, tax 1634.
  const res = await redeem(a.router, "o1", { points: 400, idempotencyKey: "idem-1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 1000, pointsCents: 400, taxCents: 1634, totalCents: 10234 });
  assert.equal(await lotPoints(a, "lot-a2"), 100); // earliest non-expired lot drained first
  assert.equal(await lotPoints(a, "lot-a1"), 300);
  assert.equal(await lotPoints(a, "lot-a3"), 1000); // expired lot never consumed
});

test("LOY-002: spills over into the next lot in expiry order", async () => {
  const a = app([pendingOrder()], aliceLots());
  const res = await redeem(a.router, "o1", { points: 600, idempotencyKey: "idem-1" });
  assert.equal(res.status, 200);
  assert.equal((res.body as RedeemedQuote).pointsCents, 600);
  assert.equal(await lotPoints(a, "lot-a2"), 0);
  assert.equal(await lotPoints(a, "lot-a1"), 200);
  assert.equal(await lotPoints(a, "lot-a3"), 1000);
});

test("LOY-002: points never exceed the payable amount; excess points are not consumed", async () => {
  const big = aliceLots().concat([{ id: "lot-a4", customerId: "alice", points: 50000, expiresAt: new Date("2027-12-31T00:00:00Z") }]);
  const a = app([pendingOrder()], big); // payable 10000 cents
  const res = await redeem(a.router, "o1", { points: 20000, idempotencyKey: "idem-1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 0, pointsCents: 10000, taxCents: 0, totalCents: 0 });
  assert.equal(await lotPoints(a, "lot-a2"), 0); // payable cap: 500 + 300 + 9200 of the 50000-lot consumed
  assert.equal(await lotPoints(a, "lot-a1"), 0);
  assert.equal(await lotPoints(a, "lot-a4"), 40800); // the rest kept
});

test("LOY-002: fewer usable points than requested consumes only what exists", async () => {
  const a = app([pendingOrder()], [{ id: "lot-x", customerId: "alice", points: 800, expiresAt: new Date("2027-01-31T00:00:00Z") }]);
  const res = await redeem(a.router, "o1", { points: 5000, idempotencyKey: "idem-1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 0, pointsCents: 800, taxCents: 1748, totalCents: 10948 });
  assert.equal(await lotPoints(a, "lot-x"), 0);
});

test("LOY-002: same key and body replays the same result and consumes nothing more", async () => {
  const a = app([pendingOrder()], aliceLots());
  const first = await redeem(a.router, "o1", { points: 400, idempotencyKey: "idem-1" });
  const replay = await redeem(a.router, "o1", { points: 400, idempotencyKey: "idem-1" });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(await lotPoints(a, "lot-a2"), 100); // unchanged by the replay
});

test("LOY-002: same key with a different body is rejected", async () => {
  const a = app([pendingOrder()], aliceLots());
  await redeem(a.router, "o1", { points: 400, idempotencyKey: "idem-1" });
  const before = await a.loyalty.lotsFor("alice");
  const res = await redeem(a.router, "o1", { points: 500, idempotencyKey: "idem-1" });
  assert.equal(res.status, 409);
  const res2 = await redeem(a.router, "o1", { points: 400, idempotencyKey: "idem-1" }, asBob);
  assert.equal(res2.status, 404); // another customer's key/request pair is simply not theirs
  assert.deepEqual(await a.loyalty.lotsFor("alice"), before); // rejected calls consume nothing
});

test("LOY-002: invalid requests are rejected without consuming points", async () => {
  const a = app([pendingOrder()], aliceLots());
  for (const body of [undefined, {}, { points: 0, idempotencyKey: "k" }, { points: -5, idempotencyKey: "k" },
    { points: 1.5, idempotencyKey: "k" }, { points: "10", idempotencyKey: "k" }, { points: 10 }, { points: 10, idempotencyKey: "" }]) {
    const res = await redeem(a.router, "o1", body);
    assert.equal(res.status, 400, `body ${JSON.stringify(body)} must be a 400`);
  }
  assert.deepEqual((await a.loyalty.lotsFor("alice")).map(l => l.points), [300, 500, 1000]);
});

test("LOY-002: only the owner's pending order can be redeemed", async () => {
  const a = app([pendingOrder({ status: "shipped" })], aliceLots());
  assert.equal((await redeem(a.router, "o1", { points: 10, idempotencyKey: "k" }, asBob)).status, 404);
  assert.equal((await redeem(a.router, "o9", { points: 10, idempotencyKey: "k" })).status, 404);
  assert.equal((await redeem(a.router, "o1", { points: 10, idempotencyKey: "k" })).status, 409);
});

test("LOY-002: concurrent redemptions for one customer never spend the same points", async () => {
  const a = app([pendingOrder()], [{ id: "lot-x", customerId: "alice", points: 300, expiresAt: new Date("2027-01-31T00:00:00Z") }]);
  const [r1, r2] = await Promise.all([
    redeem(a.router, "o1", { points: 200, idempotencyKey: "k1" }),
    redeem(a.router, "o1", { points: 200, idempotencyKey: "k2" }),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const applied = (r1.body as RedeemedQuote).pointsCents + (r2.body as RedeemedQuote).pointsCents;
  assert.equal(applied, 300); // 200 + 200 requested, only 300 existed
  assert.equal(await lotPoints(a, "lot-x"), 0);
});

test("LOY-002: concurrent identical idempotency keys settle on one redemption", async () => {
  const a = app([pendingOrder()], [{ id: "lot-x", customerId: "alice", points: 300, expiresAt: new Date("2027-01-31T00:00:00Z") }]);
  const [r1, r2] = await Promise.all([
    redeem(a.router, "o1", { points: 200, idempotencyKey: "k1" }),
    redeem(a.router, "o1", { points: 200, idempotencyKey: "k1" }),
  ]);
  assert.deepEqual(r2.body, r1.body);
  assert.equal(await lotPoints(a, "lot-x"), 100); // debited exactly once
});

test("LOY-002: cancelling a redeemed order returns points to their original lots with original expiry", async () => {
  const a = app([pendingOrder({ discountCode: "SAVE10" })], aliceLots());
  await redeem(a.router, "o1", { points: 400, idempotencyKey: "idem-1" });
  const cancelRes = await a.router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(cancelRes.status, 200);
  const lots = await a.loyalty.lotsFor("alice");
  assert.deepEqual(lots.map(l => [l.id, l.points]), [["lot-a1", 300], ["lot-a2", 500], ["lot-a3", 1000]]);
  assert.deepEqual(lots.map(l => l.expiresAt.toISOString()), ["2026-12-31T00:00:00.000Z", "2026-12-01T00:00:00.000Z", "2025-06-30T00:00:00.000Z"]);
  // The freed key was consumed by the refund: a replay is a fresh attempt on a cancelled order.
  assert.equal((await redeem(a.router, "o1", { points: 400, idempotencyKey: "idem-1" })).status, 409);
});

test("LOY-002: cancelling late forfeits points whose lot expired in the meantime", async () => {
  let clock = new Date("2026-11-19T12:00:00Z");
  const a = app([pendingOrder()], aliceLots(), () => clock);
  await redeem(a.router, "o1", { points: 400, idempotencyKey: "idem-1" }); // taken from lot-a2
  clock = new Date("2027-06-01T00:00:00Z"); // lot-a1 and lot-a2 have expired by now
  const cancelRes = await a.router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(cancelRes.status, 200);
  assert.deepEqual((await a.loyalty.lotsFor("alice")).map(l => [l.id, l.points]), [["lot-a1", 300], ["lot-a2", 100], ["lot-a3", 1000]]);
});

test("LOY-002: cancelling a non-redeemed order still works", async () => {
  const a = app([pendingOrder()], aliceLots());
  const res = await a.router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.deepEqual((await a.loyalty.lotsFor("alice")).map(l => l.points), [300, 500, 1000]);
});
