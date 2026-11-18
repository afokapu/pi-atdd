/**
 * Acceptance ORD-CANCEL-001
 * Given a pending order owned by the signed-in customer
 * When the customer sends POST /orders/:id/cancel
 * Then the response status is 200 and the stored order status is "cancelled"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice } from "./helpers.ts";

test("ORD-CANCEL-001: customer cancels their pending order", () => {
  const { router, orders } = app([{ id: "o1", customerId: "alice", status: "pending", items: ["sku-1"] }]);
  const res = router.handle({ method: "POST", path: "/orders/o1/cancel", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal(orders.get("o1")!.status, "cancelled");
});
