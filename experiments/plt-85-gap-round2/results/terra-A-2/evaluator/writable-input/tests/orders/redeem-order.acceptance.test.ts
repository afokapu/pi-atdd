import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, pendingOrder } from "./helpers.ts";

const lot = (id: string, points: number, expiresAt: string) => ({ id, customerId: "alice", points, expiresAt: new Date(expiresAt) });
const request = (points: number, idempotencyKey: string) => ({
  method: "POST" as const, path: "/orders/o1/redeem", headers: asAlice, body: { points, idempotencyKey },
});

test("LOY-002: redemption consumes earliest lots and prices points before tax", async () => {
  const { router, loyalty } = app([pendingOrder()], [
    lot("late", 500, "2027-01-01T00:00:00Z"), lot("early", 300, "2026-12-01T00:00:00Z"),
  ]);
  const res = await router.handle(request(600, "red-1"));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 0, pointsAppliedCents: 600, taxCents: 1786, totalCents: 11186 });
  assert.equal((await loyalty.getLot("early"))!.points, 0);
  assert.equal((await loyalty.getLot("late"))!.points, 200);
});

test("LOY-002: idempotency and cancellation return points", async () => {
  const { router, loyalty } = app([pendingOrder()], [lot("a", 500, "2027-01-01T00:00:00Z")]);
  const first = await router.handle(request(300, "red-1"));
  const repeated = await router.handle(request(300, "red-1"));
  assert.deepEqual(repeated.body, first.body);
  assert.equal((await loyalty.getLot("a"))!.points, 200);
  assert.equal((await router.handle(request(301, "red-1"))).status, 409);
  assert.equal((await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice })).status, 200);
  assert.equal((await loyalty.getLot("a"))!.points, 500);
});
