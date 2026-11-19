/**
 * Acceptance LOY-REDEEM-001
 * POST /orders/:id/redeem — the signed-in owner of a pending order pays part
 * of it with loyalty points (100 points = 1 EUR):
 * - non-expired lots only, earliest expiry first
 * - points reduce the amount after discounts, before tax; never below zero;
 *   excess points are not consumed
 * - idempotencyKey: same key → same result, nothing more consumed;
 *   same key with a different body → rejected
 * - cancelling a redeemed order returns points to their original lots with
 *   their original expiry; points from lots expired by then are forfeited
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "./helpers.ts";
import { seedLots } from "../../src/seed.ts";
import type { RedeemQuote } from "../../src/orders/application/redeem-service.ts";

const redeem = (id: string, body: unknown, headers: Record<string, string> = asAlice) =>
  ({
    method: "POST" as const,
    path: `/orders/${id}/redeem`,
    headers,
    body,
  });

const quote = (res: { body: unknown }) => res.body as RedeemQuote;
const lotPoints = async (loyalty: { getLot(id: string): Promise<{ points: number } | undefined> }, id: string) =>
  (await loyalty.getLot(id))!.points;

test("LOY-REDEEM-001: points applied after discount, before tax", async () => {
  // 10000 subtotal, SAVE10 → 9000 payable; redeem 400 points → 8600 taxable → 1634 tax → 10234 total.
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], [seedLots[0]!, seedLots[1]!]);
  const res = await router.handle(redeem("o1", { points: 400, idempotencyKey: "k1" }));
  assert.equal(res.status, 200);
  assert.deepEqual(quote(res), {
    region: "DE", subtotalCents: 10000, discountCents: 1000,
    pointsApplied: 400, pointsCents: 400, taxCents: 1634, totalCents: 10234,
  });
  // Consumed from the earliest-expiring non-expired lot (a2, exp 2026-12-01).
  assert.equal(await lotPoints(loyalty, "lot-a2"), 100);
  assert.equal(await lotPoints(loyalty, "lot-a1"), 300);
});

test("LOY-REDEEM-001: expired lots are never consumed", async () => {
  // lot-a3 (exp 2025-06-30) is expired at 2026-11-19; only a1+a2 (800) are usable.
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], seedLots);
  const res = await router.handle(redeem("o1", { points: 600, idempotencyKey: "k1" }));
  assert.equal(res.status, 200);
  assert.equal(quote(res).pointsApplied, 600);
  assert.equal(await lotPoints(loyalty, "lot-a2"), 0);
  assert.equal(await lotPoints(loyalty, "lot-a1"), 200);
  assert.equal(await lotPoints(loyalty, "lot-a3"), 1000); // untouched
});

test("LOY-REDEEM-001: points never reduce the amount below zero; excess not consumed", async () => {
  const { router, loyalty } = app(
    [pendingOrder({ discountCode: "SAVE10" })],
    [{ id: "lot-big", customerId: "alice", points: 20000, expiresAt: new Date("2027-12-31T00:00:00Z") }],
  );
  const res = await router.handle(redeem("o1", { points: 20000, idempotencyKey: "k1" }));
  assert.equal(res.status, 200);
  // Payable after discount is 9000 cents → at most 9000 points apply.
  assert.deepEqual(quote(res), {
    region: "DE", subtotalCents: 10000, discountCents: 1000,
    pointsApplied: 9000, pointsCents: 9000, taxCents: 0, totalCents: 0,
  });
  assert.equal(await lotPoints(loyalty, "lot-big"), 11000);
});

test("LOY-REDEEM-001: zero payable (discount covers everything) → nothing consumed", async () => {
  const { router, loyalty } = app(
    [pendingOrder({ discountCode: "FLAT5", lines: [{ sku: "a", unitPriceCents: 100, quantity: 3 }] })],
    [seedLots[0]!],
  );
  const res = await router.handle(redeem("o1", { points: 100, idempotencyKey: "k1" }));
  assert.equal(res.status, 200);
  const q = quote(res);
  assert.equal(q.pointsApplied, 0);
  assert.equal(q.totalCents, 0);
  assert.equal(await lotPoints(loyalty, "lot-a1"), 300);
});

test("LOY-REDEEM-001: same idempotency key replays the same result and consumes nothing more", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], [seedLots[0]!, seedLots[1]!]);
  const first = await router.handle(redeem("o1", { points: 400, idempotencyKey: "k1" }));
  const afterFirst = await lotPoints(loyalty, "lot-a2");
  const second = await router.handle(redeem("o1", { points: 400, idempotencyKey: "k1" }));
  assert.equal(second.status, 200);
  assert.deepEqual(quote(second), quote(first));
  assert.equal(await lotPoints(loyalty, "lot-a2"), afterFirst);
});

test("LOY-REDEEM-001: same key with a different body is rejected", async () => {
  const { router, loyalty } = app([pendingOrder({ discountCode: "SAVE10" })], [seedLots[0]!, seedLots[1]!]);
  await router.handle(redeem("o1", { points: 400, idempotencyKey: "k1" }));
  const res = await router.handle(redeem("o1", { points: 100, idempotencyKey: "k1" }));
  assert.equal(res.status, 409);
  assert.equal(await lotPoints(loyalty, "lot-a2"), 100); // nothing more consumed
});

test("LOY-REDEEM-001: same key on a different order is rejected", async () => {
  const { router } = app(
    [pendingOrder(), pendingOrder({ id: "o9", lines: [{ sku: "x", unitPriceCents: 100, quantity: 1 }] })],
    [seedLots[0]!],
  );
  await router.handle(redeem("o1", { points: 10, idempotencyKey: "k1" }));
  const res = await router.handle(redeem("o9", { points: 10, idempotencyKey: "k1" }));
  assert.equal(res.status, 409);
});

test("LOY-REDEEM-001: concurrent redemptions never spend the same points", async () => {
  const { router, loyalty } = app(
    [pendingOrder(), pendingOrder({ id: "o9" })],
    [{ id: "lot-x", customerId: "alice", points: 500, expiresAt: new Date("2027-12-31T00:00:00Z") }],
  );
  const [r1, r2] = await Promise.all([
    router.handle(redeem("o1", { points: 400, idempotencyKey: "k1" })),
    router.handle(redeem("o9", { points: 400, idempotencyKey: "k2" })),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const applied = quote(r1).pointsApplied + quote(r2).pointsApplied;
  assert.equal(applied, 500); // balance fully spent, exactly once
  assert.ok(quote(r1).pointsApplied <= 400 && quote(r2).pointsApplied <= 400);
  assert.equal(await lotPoints(loyalty, "lot-x"), 0);
});

test("LOY-REDEEM-001: cancelling a redeemed order restores original lots with original expiry", async () => {
  const { router, loyalty, orders } = app([pendingOrder({ discountCode: "SAVE10" })], [seedLots[0]!, seedLots[1]!]);
  await router.handle(redeem("o1", { points: 600, idempotencyKey: "k1" })); // 500 from a2 + 100 from a1
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal(orders.get("o1")!.status, "cancelled");
  assert.equal(await lotPoints(loyalty, "lot-a2"), 500);
  assert.equal(await lotPoints(loyalty, "lot-a1"), 300);
  assert.equal((await loyalty.getLot("lot-a2"))!.expiresAt.toISOString(), "2026-12-01T00:00:00.000Z");
});

test("LOY-REDEEM-001: points of a lot expired by cancel time are forfeited", async () => {
  let now = new Date("2026-11-19T12:00:00Z");
  const { router, loyalty } = app([pendingOrder()], [seedLots[1]!], () => now);
  await router.handle(redeem("o1", { points: 500, idempotencyKey: "k1" })); // all of lot-a2
  assert.equal(await lotPoints(loyalty, "lot-a2"), 0);
  now = new Date("2026-12-02T00:00:00Z"); // lot-a2 expired meanwhile
  const res = await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal(await lotPoints(loyalty, "lot-a2"), 0); // forfeited, not resurrected
});

test("LOY-REDEEM-001: cancelled orders cannot be redeemed again", async () => {
  const { router } = app([pendingOrder()], [seedLots[0]!]);
  await router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  const res = await router.handle(redeem("o1", { points: 100, idempotencyKey: "k1" }));
  assert.equal(res.status, 409);
});

test("LOY-REDEEM-001: shipped orders cannot be redeemed", async () => {
  const { router } = app([pendingOrder({ status: "shipped" })], [seedLots[0]!]);
  const res = await router.handle(redeem("o1", { points: 100, idempotencyKey: "k1" }));
  assert.equal(res.status, 409);
});

test("LOY-REDEEM-001: only the owner can redeem; unknown orders are 404", async () => {
  const { router } = app([pendingOrder()], [seedLots[0]!]);
  assert.equal((await router.handle(redeem("o1", { points: 100, idempotencyKey: "k1" }, asBob))).status, 404);
  assert.equal((await router.handle(redeem("missing", { points: 100, idempotencyKey: "k1" }))).status, 404);
  assert.equal((await router.handle(redeem("o1", { points: 100, idempotencyKey: "k1" }, {}))).status, 401);
});

test("LOY-REDEEM-001: invalid bodies are rejected", async () => {
  const { router } = app([pendingOrder()], [seedLots[0]!]);
  const bad = [
    { points: 0, idempotencyKey: "k" },
    { points: -5, idempotencyKey: "k" },
    { points: 1.5, idempotencyKey: "k" },
    { points: "100", idempotencyKey: "k" },
    { points: 100 },
    { points: 100, idempotencyKey: "" },
    {},
  ];
  for (const body of bad) {
    const res = await router.handle(redeem("o1", body));
    assert.equal(res.status, 400, "body: " + JSON.stringify(body));
  }
});
