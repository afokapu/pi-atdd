/**
 * Acceptance LOY-REDEEM-001
 * Given a pending order owned by the signed-in customer
 * When the customer sends POST /orders/:id/redeem with { points, idempotencyKey }
 * Then the response is the new quote (points applied after discount, before tax),
 * the earliest-expiring lots are consumed, and retries with the same key are idempotent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "../orders/helpers.ts";
import { seedLots } from "../../src/seed.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const redeem = (router: ReturnType<typeof app>["router"], key: string, points: number, headers = asAlice) =>
  router.handle({ method: "POST", path: "/orders/o1/redeem", headers, body: { points, idempotencyKey: key } });

const lotById = async (loyalty: ReturnType<typeof app>["loyalty"], customerId: string) =>
  new Map((await loyalty.lotsFor(customerId)).map(l => [l.id, l]));

test("LOY-REDEEM-001: redeem applies points after discount, before tax, earliest-expiring lots first", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  const res = await redeem(router, "key-1", 300);
  assert.equal(res.status, 200);
  // 10000 subtotal, no discount; 300 points = 300 cents → taxable 9700; 19% = 1843
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 0, pointsCents: 300, taxCents: 1843, totalCents: 11543 });
  const lots = await lotById(loyalty, "alice");
  assert.equal(lots.get("lot-a2")!.points, 200); // expires 2026-12-01, drawn first
  assert.equal(lots.get("lot-a1")!.points, 300); // expires 2026-12-31, untouched
  assert.equal(lots.get("lot-a3")!.points, 1000); // expired lot, never consumed
});

test("LOY-REDEEM-001: points reduce after discount; excess points are not consumed", async () => {
  const lots: PointsLot[] = [1, 2, 3, 4, 5].map(i =>
    ({ id: "l" + i, customerId: "alice", points: 2000, expiresAt: new Date("2027-0" + i + "-01T00:00:00Z") }));
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], lots);
  const res = await redeem(router, "key-big", 9500);
  assert.equal(res.status, 200);
  // 10000 − 1000 discount = 9000 taxable; 9500 requested but only 9000 applicable → total 0
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 1000, pointsCents: 9000, taxCents: 0, totalCents: 0 });
  const remaining = (await loyalty.lotsFor("alice")).reduce((sum, l) => sum + l.points, 0);
  assert.equal(remaining, 1000); // exactly 9000 consumed, the 500 excess points stay
});

test("same key and payload replays the stored result and consumes nothing more", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  const first = await redeem(router, "key-1", 300);
  const again = await redeem(router, "key-1", 300);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body);
  const lots = await lotById(loyalty, "alice");
  assert.equal(lots.get("lot-a2")!.points, 200); // unchanged since the first call
});

test("same key with a different body is rejected and changes nothing", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  await redeem(router, "key-1", 300);
  const res = await redeem(router, "key-1", 100);
  assert.equal(res.status, 409);
  assert.equal((res.body as { error_code: string }).error_code, "IDEMPOTENCY_CONFLICT");
  const lots = await lotById(loyalty, "alice");
  assert.equal(lots.get("lot-a2")!.points, 200); // nothing further consumed
});

test("redeeming more points than the customer can spend is rejected without changes", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots); // alice: 800 spendable points
  const res = await redeem(router, "key-1", 801);
  assert.equal(res.status, 409);
  assert.equal((res.body as { error_code: string }).error_code, "INSUFFICIENT_POINTS");
  const lots = await lotById(loyalty, "alice");
  assert.equal(lots.get("lot-a1")!.points, 300);
  assert.equal(lots.get("lot-a2")!.points, 500);
});

test("only pending orders can be redeemed; foreign orders are not found", async () => {
  const { router } = app([pendingOrder({ status: "shipped" })], seedLots);
  assert.equal((await redeem(router, "k", 100)).status, 409);
  const other = app([pendingOrder()], seedLots); // o1 belongs to alice
  assert.equal((await redeem(other.router, "k", 100, asBob)).status, 404);
});

test("redeem validates the body", async () => {
  const { router } = app([pendingOrder()], seedLots);
  const bad = (body: unknown) => router.handle({ method: "POST", path: "/orders/o1/redeem", headers: asAlice, body });
  for (const body of [undefined, {}, { points: 0, idempotencyKey: "k" }, { points: -5, idempotencyKey: "k" },
    { points: 1.5, idempotencyKey: "k" }, { points: "100", idempotencyKey: "k" }, { points: 100 }]) {
    const res = await bad(body);
    assert.equal(res.status, 400, "expected 400 for " + JSON.stringify(body));
    assert.match(String((res.body as { error_code: string }).error_code), /^[A-Z][A-Z0-9_]+$/);
  }
});

test("redeem requires authentication", async () => {
  const { router } = app([pendingOrder()], seedLots);
  const res = await router.handle({ method: "POST", path: "/orders/o1/redeem", headers: {}, body: { points: 100, idempotencyKey: "k" } });
  assert.equal(res.status, 401);
});

test("concurrent redemptions for one customer never spend the same points", async () => {
  // Two lots of 300; two overlapping redemptions of 300 each: both must succeed
  // on distinct draws — a lost update would leave points behind or overdraw.
  const lots: PointsLot[] = [
    { id: "l1", customerId: "alice", points: 300, expiresAt: new Date("2027-01-31T00:00:00Z") },
    { id: "l2", customerId: "alice", points: 300, expiresAt: new Date("2027-02-28T00:00:00Z") },
  ];
  const { router, loyalty } = app([pendingOrder()], lots);
  const [r1, r2] = await Promise.all([redeem(router, "k1", 300), redeem(router, "k2", 300)]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const remaining = (await loyalty.lotsFor("alice")).reduce((sum, l) => sum + l.points, 0);
  assert.equal(remaining, 0); // exactly 600 consumed, no point spent twice
});

test("overlapping redemptions cannot overspend: the second finds insufficient points", async () => {
  const lots: PointsLot[] = [{ id: "l1", customerId: "alice", points: 500, expiresAt: new Date("2027-01-31T00:00:00Z") }];
  const { router, loyalty } = app([pendingOrder()], lots);
  const [r1, r2] = await Promise.all([redeem(router, "k1", 300), redeem(router, "k2", 300)]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [200, 409]); // exactly one redemption wins
  const lot = (await lotById(loyalty, "alice")).get("l1")!;
  assert.equal(lot.points, 200); // 300 consumed exactly once
});
