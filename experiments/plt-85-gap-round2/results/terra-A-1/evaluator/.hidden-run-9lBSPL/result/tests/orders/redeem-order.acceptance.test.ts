import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, pendingOrder } from "./helpers.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const lots: PointsLot[] = [
  { id: "late", customerId: "alice", points: 500, expiresAt: new Date("2027-01-01T00:00:00Z") },
  { id: "early", customerId: "alice", points: 700, expiresAt: new Date("2026-12-01T00:00:00Z") },
];

const redeem = (router: ReturnType<typeof app>["router"], points: number, idempotencyKey = "key") =>
  router.handle({ method: "POST", path: "/orders/o1/redeem", headers: asAlice, body: { points, idempotencyKey } });

test("redeem spends earliest lots, before tax, and is idempotent", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], lots);
  const first = await redeem(router, 800);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, {
    region: "DE", subtotalCents: 10000, discountCents: 1000,
    pointsAppliedCents: 800, taxCents: 1558, totalCents: 9758,
  });
  assert.equal((await loyalty.getLot("early"))!.points, 0);
  assert.equal((await loyalty.getLot("late"))!.points, 400);
  assert.deepEqual((await redeem(router, 800)).body, first.body);
  assert.equal((await loyalty.getLot("late"))!.points, 400);
  assert.equal((await redeem(router, 801)).status, 409);
});

test("cancelling returns only points whose source lots have not expired", async () => {
  let now = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty } = app([pendingOrder()], lots, () => now);
  await redeem(router, 800);
  now = new Date("2026-12-02T00:00:00Z");
  assert.equal((await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice })).status, 200);
  assert.equal((await loyalty.getLot("early"))!.points, 0);
  assert.equal((await loyalty.getLot("late"))!.points, 500);
});

test("concurrent redemption requests do not overspend a customer ledger", async () => {
  const second = { ...pendingOrder(), id: "o2" };
  const { router, loyalty } = app([pendingOrder(), second], [lots[0]!]);
  const request = (id: string) => router.handle({ method: "POST", path: `/orders/${id}/redeem`, headers: asAlice, body: { points: 500, idempotencyKey: id } });
  await Promise.all([request("o1"), request("o2")]);
  assert.equal((await loyalty.getLot("late"))!.points, 0);
});
