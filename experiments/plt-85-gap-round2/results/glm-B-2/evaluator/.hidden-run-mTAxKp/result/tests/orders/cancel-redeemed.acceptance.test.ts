/**
 * Acceptance LOY-CANCEL-REDEEM-001
 * Given a redeemed pending order
 * When the customer cancels it
 * Then the redeemed points return to their original lots with their original
 * expiry, points from lots that expired in the meantime are forfeited, and a
 * retried redeem still replays the original quote without touching the ledger.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asAlice, pendingOrder } from "./helpers.ts";
import { createApp } from "../../src/app.ts";
import { InMemoryOrderStore } from "../../src/orders/integration/order-store.ts";
import { InMemoryLoyaltyStore } from "../../src/loyalty/integration/loyalty-store.ts";
import { InMemoryRedemptionStore } from "../../src/orders/integration/redemption-store.ts";
import { seedTokens } from "../../src/seed.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";

const sessions = { lookup: (t: string) => (seedTokens[t] ? { id: seedTokens[t]! } : undefined) };
const redeem = (router: ReturnType<typeof createApp>, key: string, points: number) =>
  router.handle({ method: "POST", path: "/orders/o1/redeem", headers: asAlice, body: { points, idempotencyKey: key } });
const cancel = (router: ReturnType<typeof createApp>) =>
  router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });

const restoredLots = (): PointsLot[] => [
  { id: "lot-early", customerId: "alice", points: 300, expiresAt: new Date("2026-12-01T00:00:00Z") },
  { id: "lot-late", customerId: "alice", points: 300, expiresAt: new Date("2027-06-01T00:00:00Z") },
];

test("LOY-CANCEL-REDEEM-001: cancelling a redeemed order restores points to their original lots", async () => {
  const orders = new InMemoryOrderStore([pendingOrder()]);
  const loyalty = new InMemoryLoyaltyStore(restoredLots());
  const redemptions = new InMemoryRedemptionStore();
  const router = createApp({ orders, loyalty, sessions, redemptions });

  assert.equal((await redeem(router, "k1", 400)).status, 200); // early 300->0, late 300->200
  assert.equal((await loyalty.getLot("lot-early"))!.points, 0);
  const cancelled = await cancel(router);
  assert.equal(cancelled.status, 200);
  assert.equal(orders.get("o1")!.status, "cancelled");
  // Both debits return to the exact lots they came from, expiry untouched.
  assert.deepEqual(await loyalty.getLot("lot-early"), {
    id: "lot-early", customerId: "alice", points: 300, expiresAt: new Date("2026-12-01T00:00:00Z"),
  });
  assert.deepEqual(await loyalty.getLot("lot-late"), {
    id: "lot-late", customerId: "alice", points: 300, expiresAt: new Date("2027-06-01T00:00:00Z"),
  });
});

test("LOY-CANCEL-REDEEM-001: points from lots that expired before the cancel are forfeited", async () => {
  const lots: PointsLot[] = [
    { id: "lot-a", customerId: "alice", points: 500, expiresAt: new Date("2026-03-01T00:00:00Z") },
    { id: "lot-b", customerId: "alice", points: 500, expiresAt: new Date("2027-01-01T00:00:00Z") },
  ];
  const orders = new InMemoryOrderStore([pendingOrder()]);
  const loyalty = new InMemoryLoyaltyStore(lots);
  const redemptions = new InMemoryRedemptionStore();
  // Two apps sharing the stores, with the clock advanced between redeem and cancel.
  const inJanuary = createApp({ orders, loyalty, sessions, redemptions, now: () => new Date("2026-01-15T00:00:00Z") });
  const inJune = createApp({ orders, loyalty, sessions, redemptions, now: () => new Date("2026-06-01T00:00:00Z") });

  const res = await redeem(inJanuary, "k1", 600); // lot-a 500->0 (earliest), lot-b 500->400
  assert.equal(res.status, 200);
  assert.equal((await loyalty.getLot("lot-a"))!.points, 0);

  assert.equal((await cancel(inJune)).status, 200);
  // lot-b is still valid: its 100 points come back with the original expiry.
  assert.deepEqual(await loyalty.getLot("lot-b"), {
    id: "lot-b", customerId: "alice", points: 500, expiresAt: new Date("2027-01-01T00:00:00Z"),
  });
  // lot-a expired in the meantime: its 500 points are forfeited, not restored.
  assert.equal((await loyalty.getLot("lot-a"))!.points, 0);
});

test("LOY-CANCEL-REDEEM-001: a retried redeem after the cancel replays the stored quote", async () => {
  const orders = new InMemoryOrderStore([pendingOrder()]);
  const loyalty = new InMemoryLoyaltyStore(restoredLots());
  const redemptions = new InMemoryRedemptionStore();
  const router = createApp({ orders, loyalty, sessions, redemptions });

  const first = await redeem(router, "k1", 100);
  await cancel(router);
  const retry = await redeem(router, "k1", 100);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body, first.body);
  assert.equal((await loyalty.getLot("lot-early"))!.points, 300); // no extra consumption
});

test("LOY-CANCEL-REDEEM-001: cancelling an order without redemptions works as before", async () => {
  const orders = new InMemoryOrderStore([pendingOrder()]);
  const loyalty = new InMemoryLoyaltyStore(restoredLots());
  const redemptions = new InMemoryRedemptionStore();
  const router = createApp({ orders, loyalty, sessions, redemptions });

  const cancelled = await cancel(router);
  assert.equal(cancelled.status, 200);
  assert.equal(orders.get("o1")!.status, "cancelled");
  assert.equal((await loyalty.getLot("lot-early"))!.points, 300); // untouched
});
