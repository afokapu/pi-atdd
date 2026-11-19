/**
 * Acceptance LOY-REDEEM-001
 * Given a pending order owned by the signed-in customer with points held in lots
 * When the customer sends POST /orders/:id/redeem { points, idempotencyKey }
 * Then points are consumed from non-expired lots (earliest expiry first),
 *      the quote applies them after discount and before tax (never below zero,
 *      excess points are not consumed), replays with the same key return the
 *      same result without consuming more, and cancelling returns the points
 *      to their original lots (forfeiting lots that expired in the meantime).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "./helpers.ts";
import { seedLots } from "../../src/seed.ts";

/** o1 seed lines: book 1999x2 + pen 350x3 -> subtotal 5048; SAVE10 -> -505 -> 4543 before tax. */
const redeemBody = (points: number, idempotencyKey: string) => ({ points, idempotencyKey });

const post = (router: ReturnType<typeof app>["router"], id: string, body: unknown, headers = asAlice) =>
  router.handle({ method: "POST", path: `/orders/${id}/redeem`, headers, body });

test("LOY-REDEEM-001: redeems points after discount, before tax, earliest expiry first", async () => {
  const { router, loyalty } = app([pendingOrder({ id: "o1", customerId: "alice", region: "DE", discountCode: "SAVE10" })], seedLots);
  const res = await post(router, "o1", redeemBody(600, "k1"));
  assert.equal(res.status, 200);
  // subtotal 10000 - discount 1000 = 9000; 600 points reduce it to 8400; 19% tax = 1596
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 10000, discountCents: 1000, pointsCents: 600, taxCents: 1596, totalCents: 9996,
  });
  // lot-a2 expires first (2026-12-01): fully consumed; lot-a1 takes the rest; expired lot-a3 untouched
  assert.deepEqual((await loyalty.lotsFor("alice")).map(l => ({ id: l.id, points: l.points })), [
    { id: "lot-a1", points: 200 },
    { id: "lot-a2", points: 0 },
    { id: "lot-a3", points: 1000 },
  ]);
});

test("LOY-REDEEM-001: expired lots are never consumed", async () => {
  const { router, loyalty } = app([pendingOrder()], seedLots);
  const res = await post(router, "o1", redeemBody(500, "k1"));
  assert.equal(res.status, 200);
  const a3 = (await loyalty.lotsFor("alice")).find(l => l.id === "lot-a3")!;
  assert.equal(a3.points, 1000); // expired 2025-06-30, still intact
});

test("LOY-REDEEM-001: points never push the amount below zero; excess points are not consumed", async () => {
  const bigLot = { id: "lot-big", customerId: "alice", points: 20000, expiresAt: new Date("2027-01-01T00:00:00Z") };
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], [bigLot]);
  const res = await post(router, "o1", redeemBody(10000, "k1"));
  assert.equal(res.status, 200);
  // discounted amount is 9000 cents: exactly 9000 points applied, nothing more
  assert.deepEqual(res.body, {
    region: "DE", subtotalCents: 10000, discountCents: 1000, pointsCents: 9000, taxCents: 0, totalCents: 0,
  });
  assert.equal((await loyalty.getLot("lot-big"))!.points, 11000);
});

test("LOY-REDEEM-001: a short balance applies only what is available", async () => {
  const lot = { id: "lot-x", customerId: "alice", points: 300, expiresAt: new Date("2027-01-01T00:00:00Z") };
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], [lot]);
  const res = await post(router, "o1", redeemBody(5000, "k1"));
  assert.equal(res.status, 200);
  assert.equal((res.body as { pointsCents: number }).pointsCents, 300);
  assert.equal((await loyalty.getLot("lot-x"))!.points, 0);
});

test("LOY-REDEEM-001: same idempotency key replays the same result, nothing more consumed", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots);
  const first = await post(router, "o1", redeemBody(500, "k1"));
  assert.equal(first.status, 200);
  const replay = await post(router, "o1", redeemBody(500, "k1"));
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);
  const totals = (await loyalty.lotsFor("alice")).reduce((s, l) => s + l.points, 0);
  assert.equal(totals, 300 + 0 + 1000); // consumed exactly once
});

test("LOY-REDEEM-001: same key with a different body is rejected", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots);
  assert.equal((await post(router, "o1", redeemBody(500, "k1"))).status, 200);
  const res = await post(router, "o1", redeemBody(400, "k1"));
  assert.equal(res.status, 409);
  // the rejected request consumed nothing
  const a1 = (await loyalty.lotsFor("alice")).find(l => l.id === "lot-a1")!;
  assert.equal(a1.points, 300);
});

test("LOY-REDEEM-001: concurrent redemptions of one customer never spend the same points", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots);
  const [r1, r2] = await Promise.all([
    post(router, "o1", redeemBody(400, "c1")),
    post(router, "o1", redeemBody(400, "c2")),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  // each response is the order's new quote: the first shows its own 400, the second the accumulated 800
  assert.deepEqual([r1.body, r2.body].map(b => (b as { pointsCents: number }).pointsCents), [400, 800]);
  const lots = await loyalty.lotsFor("alice");
  // exactly the two redemptions consumed, no double spend; the expired lot-a3 keeps its 1000
  assert.deepEqual(lots.map(l => ({ id: l.id, points: l.points })), [
    { id: "lot-a1", points: 0 },
    { id: "lot-a2", points: 0 },
    { id: "lot-a3", points: 1000 },
  ]);
});

test("LOY-REDEEM-001: concurrent replays of the same key consume once and return the same result", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots);
  const [r1, r2] = await Promise.all([
    post(router, "o1", redeemBody(400, "same")),
    post(router, "o1", redeemBody(400, "same")),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.body, r1.body);
  const lots = await loyalty.lotsFor("alice");
  assert.deepEqual(lots.map(l => ({ id: l.id, points: l.points })), [
    { id: "lot-a1", points: 300 },
    { id: "lot-a2", points: 100 }, // consumed exactly once
    { id: "lot-a3", points: 1000 },
  ]);
});

test("LOY-REDEEM-001: concurrent redeem and cancel never lose points", async () => {
  const { router, loyalty, orders } = app([pendingOrder({ id: "o1", discountCode: "SAVE10" })], seedLots);
  const [r, c] = await Promise.all([
    post(router, "o1", redeemBody(400, "k1")),
    router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice }),
  ]);
  const aliceLots = await loyalty.lotsFor("alice");
  const spendable = aliceLots.filter(l => l.id !== "lot-a3").reduce((s, l) => s + l.points, 0);
  // Whatever the interleaving, no points are lost and the order ends cancelled:
  // either cancel ran first (redeem rejected, lots untouched) or redeem ran first
  // and the cancellation refunded every consumed point to its original lot.
  assert.ok(c.status === 200);
  assert.ok(r.status === 200 || r.status === 409);
  assert.equal(spendable, 800);
  assert.equal(orders.get("o1")!.status, "cancelled");
  const a1 = aliceLots.find(l => l.id === "lot-a1")!;
  const a2 = aliceLots.find(l => l.id === "lot-a2")!;
  if (r.status === 200) assert.deepEqual([a1.points, a2.points], [300, 500]); // exactly refunded
});

test("LOY-REDEEM-001: cancelling a redeemed order returns points to their original lots with original expiry", async () => {
  const { router, loyalty, orders } = app([pendingOrder({ id: "o1", discountCode: "SAVE10" })], seedLots);
  await post(router, "o1", redeemBody(600, "k1"));
  const cancel = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(cancel.status, 200);
  assert.equal(orders.get("o1")!.status, "cancelled");
  assert.deepEqual(await loyalty.lotsFor("alice"), seedLots.filter(l => l.customerId === "alice")); // same ids, points and expiry as before the redemption
});

test("LOY-REDEEM-001: points whose lot expired before cancellation are forfeited", async () => {
  let now = new Date("2026-11-19T12:00:00Z");
  const lots = [
    { id: "lot-soon", customerId: "alice", points: 200, expiresAt: new Date("2026-11-20T00:00:00Z") },
    { id: "lot-late", customerId: "alice", points: 400, expiresAt: new Date("2027-06-30T00:00:00Z") },
  ];
  const { router, loyalty } = app([pendingOrder({ id: "o1", discountCode: "SAVE10" })], lots, () => now);
  const res = await post(router, "o1", redeemBody(200, "k1")); // consumes lot-soon (earliest expiry, still valid)
  assert.equal(res.status, 200);
  now = new Date("2026-11-21T12:00:00Z"); // lot-soon expires before the cancellation
  const cancel = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(cancel.status, 200);
  const after = await loyalty.lotsFor("alice");
  assert.deepEqual(after.map(l => ({ id: l.id, points: l.points })), [
    { id: "lot-soon", points: 0 }, // forfeited
    { id: "lot-late", points: 400 }, // untouched by the redemption
  ]);
});

test("LOY-REDEEM-001: only pending orders of the signed-in customer can be redeemed", async () => {
  const { router } = app([pendingOrder({ id: "o1" }), pendingOrder({ id: "o2", status: "shipped" })], seedLots);
  assert.equal((await post(router, "o2", redeemBody(100, "k1"))).status, 409);
  assert.equal((await post(router, "o1", redeemBody(100, "k1"), asBob)).status, 404);
  assert.equal(
    (await router.handle({ method: "POST", path: "/orders/o1/redeem", headers: {}, body: redeemBody(100, "k1") })).status,
    401,
  );
});

test("LOY-REDEEM-001: validates the request body", async () => {
  const { router } = app([pendingOrder()], seedLots);
  for (const bad of [undefined, {}, { points: 0, idempotencyKey: "k" }, { points: -5, idempotencyKey: "k" },
    { points: 1.5, idempotencyKey: "k" }, { points: "100", idempotencyKey: "k" }, { points: 100 },
    { points: 100, idempotencyKey: "" }]) {
    const res = await router.handle({ method: "POST", path: "/orders/o1/redeem", headers: asAlice, body: bad });
    assert.equal(res.status, 400, `expected 400 for body ${JSON.stringify(bad)}`);
  }
});

test("LOY-REDEEM-001: several redemptions accumulate; the quote reflects the total applied", async () => {
  const bigLot = { id: "lot-big", customerId: "alice", points: 20000, expiresAt: new Date("2027-01-01T00:00:00Z") };
  const { router } = app([pendingOrder({ discountCode: "SAVE10" })], [bigLot]);
  const first = await post(router, "o1", redeemBody(4000, "k1"));
  assert.equal((first.body as { pointsCents: number }).pointsCents, 4000);
  const second = await post(router, "o1", redeemBody(4000, "k2"));
  // total applied 8000; taxable 9000 - 8000 = 1000; tax = 190; total = 1190
  assert.deepEqual(second.body, {
    region: "DE", subtotalCents: 10000, discountCents: 1000, pointsCents: 8000, taxCents: 190, totalCents: 1190,
  });
});
