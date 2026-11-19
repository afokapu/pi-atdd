/**
 * Acceptance LOY-002 — Pay with loyalty points.
 * POST /orders/:id/redeem { points, idempotencyKey } by the owner of a pending order.
 * Non-expired lots are consumed earliest expiry first; 100 points = 1 EUR; points reduce
 * the amount after discount and before tax, never below zero; excess is not consumed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "../orders/helpers.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const lots = (): PointsLot[] => [
  { id: "lot-a1", customerId: "alice", points: 300, expiresAt: new Date("2026-12-31T00:00:00Z") },
  { id: "lot-a2", customerId: "alice", points: 500, expiresAt: new Date("2026-12-01T00:00:00Z") },
  { id: "lot-a3", customerId: "alice", points: 1000, expiresAt: new Date("2025-06-30T00:00:00Z") },
  { id: "lot-b1", customerId: "bob", points: 250, expiresAt: new Date("2027-03-31T00:00:00Z") },
];
const redeem = (id: string, body: unknown, headers: Record<string, string> = asAlice) =>
  ({ method: "POST" as const, path: "/orders/" + id + "/redeem", headers, body });
const balances = async (loyalty: { lotsFor(c: string): Promise<PointsLot[]> }, c = "alice") =>
  Object.fromEntries((await loyalty.lotsFor(c)).map(l => [l.id, l.points]));

test("LOY-002: points reduce the amount before tax, earliest-expiring lot first", async () => {
  const { router, loyalty } = app([pendingOrder()], lots());
  const res = await router.handle(redeem("o1", { points: 600, idempotencyKey: "k1" }));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 0, pointsAppliedCents: 600, taxCents: 1786, totalCents: 11186 });
  assert.deepEqual(await balances(loyalty), { "lot-a1": 200, "lot-a2": 0, "lot-a3": 1000 });
  const q = await router.handle({ method: "GET", path: "/orders/o1/quote", headers: asAlice });
  assert.deepEqual(q.body, res.body);
});

test("LOY-002: points apply after the discount", async () => {
  const { router } = app([pendingOrder({ discountCode: "SAVE10" })], lots());
  const res = await router.handle(redeem("o1", { points: 600, idempotencyKey: "k1" }));
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 1000, pointsAppliedCents: 600, taxCents: 1596, totalCents: 9996 });
});

test("LOY-002: never below zero, excess points not consumed", async () => {
  const { router, loyalty } = app([pendingOrder({ lines: [{ sku: "x", unitPriceCents: 1000, quantity: 1 }], discountCode: "FLAT5" })], lots());
  const res = await router.handle(redeem("o1", { points: 800, idempotencyKey: "k1" }));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 1000, discountCents: 500, pointsAppliedCents: 500, taxCents: 0, totalCents: 0 });
  assert.deepEqual(await balances(loyalty), { "lot-a1": 300, "lot-a2": 0, "lot-a3": 1000 });
});

test("LOY-002: expired lots are not usable; insufficient points consume nothing", async () => {
  const { router, loyalty, orders } = app([pendingOrder()], lots());
  const res = await router.handle(redeem("o1", { points: 801, idempotencyKey: "k1" }));
  assert.equal(res.status, 422);
  assert.deepEqual(await balances(loyalty), { "lot-a1": 300, "lot-a2": 500, "lot-a3": 1000 });
  assert.equal(orders.get("o1")!.redemption, undefined);
});

test("LOY-002: lot is unusable at its expiry instant", async () => {
  const { router } = app([pendingOrder()], lots(), () => new Date("2026-12-01T00:00:00Z"));
  assert.equal((await router.handle(redeem("o1", { points: 301, idempotencyKey: "k1" }))).status, 422);
});

test("LOY-002: same key replays the result without consuming more", async () => {
  const { router, loyalty } = app([pendingOrder()], lots());
  const a = await router.handle(redeem("o1", { points: 100, idempotencyKey: "k1" }));
  const b = await router.handle(redeem("o1", { points: 100, idempotencyKey: "k1" }));
  assert.equal(b.status, 200);
  assert.deepEqual(b.body, a.body);
  assert.deepEqual(await balances(loyalty), { "lot-a1": 300, "lot-a2": 400, "lot-a3": 1000 });
});

test("LOY-002: concurrent same-key requests consume once", async () => {
  const { router, loyalty } = app([pendingOrder()], lots());
  const rs = await Promise.all([1, 2, 3].map(() => router.handle(redeem("o1", { points: 100, idempotencyKey: "k1" }))));
  assert.deepEqual(rs.map(r => r.status), [200, 200, 200]);
  assert.deepEqual(await balances(loyalty), { "lot-a1": 300, "lot-a2": 400, "lot-a3": 1000 });
});

test("LOY-002: same key with a different body is rejected", async () => {
  const { router, loyalty } = app([pendingOrder(), pendingOrder({ id: "o2" })], lots());
  await router.handle(redeem("o1", { points: 100, idempotencyKey: "k1" }));
  assert.equal((await router.handle(redeem("o1", { points: 200, idempotencyKey: "k1" }))).status, 422);
  assert.equal((await router.handle(redeem("o2", { points: 100, idempotencyKey: "k1" }))).status, 422);
  assert.deepEqual(await balances(loyalty), { "lot-a1": 300, "lot-a2": 400, "lot-a3": 1000 });
});

test("LOY-002: concurrent redemptions never spend the same points", async () => {
  const { router, loyalty } = app([pendingOrder(), pendingOrder({ id: "o2" })], lots());
  const [r1, r2] = await Promise.all([
    router.handle(redeem("o1", { points: 500, idempotencyKey: "k1" })),
    router.handle(redeem("o2", { points: 500, idempotencyKey: "k2" })),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 422]);
  const b = await balances(loyalty);
  assert.equal(b["lot-a1"]! + b["lot-a2"]!, 300);
});

test("LOY-002: one redemption per order; only pending orders; only the owner", async () => {
  const { router } = app([pendingOrder(), pendingOrder({ id: "o2", status: "shipped" })], lots());
  assert.equal((await router.handle(redeem("o1", { points: 100, idempotencyKey: "k1" }))).status, 200);
  assert.equal((await router.handle(redeem("o1", { points: 100, idempotencyKey: "k2" }))).status, 409);
  assert.equal((await router.handle(redeem("o2", { points: 100, idempotencyKey: "k3" }))).status, 409);
  assert.equal((await router.handle(redeem("o1", { points: 100, idempotencyKey: "k4" }, asBob))).status, 404);
  assert.equal((await router.handle(redeem("o1", { points: 100, idempotencyKey: "k5" }, {}))).status, 401);
});

test("LOY-002: invalid bodies are rejected", async () => {
  const { router } = app([pendingOrder()], lots());
  for (const body of [undefined, {}, { points: 0, idempotencyKey: "k" }, { points: 1.5, idempotencyKey: "k" },
    { points: "100", idempotencyKey: "k" }, { points: 100 }, { points: 100, idempotencyKey: "" }])
    assert.equal((await router.handle(redeem("o1", body))).status, 400, JSON.stringify(body));
});

test("LOY-002: cancelling returns points to their original lots; expired lots forfeit", async () => {
  let now = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty, orders } = app([pendingOrder(), pendingOrder({ id: "o2" })], lots(), () => now);
  await router.handle(redeem("o1", { points: 600, idempotencyKey: "k1" }));
  now = new Date("2026-12-01T00:00:00Z"); // lot-a2 expires at this instant
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  const all = await loyalty.lotsFor("alice");
  assert.deepEqual(Object.fromEntries(all.map(l => [l.id, l.points])), { "lot-a1": 300, "lot-a2": 0, "lot-a3": 1000 });
  assert.equal(all.find(l => l.id === "lot-a1")!.expiresAt.toISOString(), "2026-12-31T00:00:00.000Z");
  assert.deepEqual(orders.get("o1")!.redemption!.refund, { returnedPoints: 100, forfeitedPoints: 500 });
  // second cancel does not credit again
  assert.equal((await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice })).status, 409);
  assert.equal((await loyalty.getLot("lot-a1"))!.points, 300);
});

test("LOY-002: cancel before expiry restores every lot", async () => {
  const { router, loyalty } = app([pendingOrder()], lots());
  await router.handle(redeem("o1", { points: 600, idempotencyKey: "k1" }));
  await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.deepEqual(await balances(loyalty), { "lot-a1": 300, "lot-a2": 500, "lot-a3": 1000 });
});

test("LOY-002: concurrent cancel and redeem do not double-credit", async () => {
  const { router, loyalty } = app([pendingOrder()], lots());
  await router.handle(redeem("o1", { points: 600, idempotencyKey: "k1" }));
  const rs = await Promise.all([1, 2].map(() => router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice })));
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 409]);
  assert.deepEqual(await balances(loyalty), { "lot-a1": 300, "lot-a2": 500, "lot-a3": 1000 });
});
