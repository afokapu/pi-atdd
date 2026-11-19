import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryLoyaltyStore } from "../../src/loyalty/integration/loyalty-store.ts";
import { isExpired } from "../../src/loyalty/domain/points.ts";
import { seedLots } from "../../src/seed.ts";

test("loyalty store returns copies of a customer's lots", async () => {
  const store = new InMemoryLoyaltyStore(seedLots);
  const lots = await store.lotsFor("alice");
  assert.deepEqual(lots.map(l => l.id), ["lot-a1", "lot-a2", "lot-a3"]);
  lots[0]!.points = 0;
  assert.equal((await store.getLot("lot-a1"))!.points, 300);
});

test("lot expiry is exclusive of the expiry instant", () => {
  const lot = seedLots[1]!;
  assert.equal(isExpired(lot, new Date("2026-11-30T23:59:59Z")), false);
  assert.equal(isExpired(lot, lot.expiresAt), true);
});
