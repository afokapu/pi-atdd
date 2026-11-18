/**
 * Acceptance ORD-MERGE-001
 * Given two pending orders owned by the signed-in customer
 * When the customer sends POST /orders/merge with { sourceId, targetId }
 * Then the response status is 200, the target order holds the items of both orders
 *  and the source order is stored as "cancelled"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice } from "./helpers.ts";

test("ORD-MERGE-001: customer merges two of their pending orders", () => {
  const { router, orders } = app([
    { id: "o1", customerId: "alice", status: "pending", items: ["sku-1"] },
    { id: "o2", customerId: "alice", status: "pending", items: ["sku-2"] },
  ]);
  const res = router.handle({ method: "POST", path: "/orders/merge", headers: asAlice, body: { sourceId: "o1", targetId: "o2" } });
  assert.equal(res.status, 200);
  assert.deepEqual(orders.get("o2")!.items.sort(), ["sku-1", "sku-2"]);
  assert.equal(orders.get("o1")!.status, "cancelled");
});
