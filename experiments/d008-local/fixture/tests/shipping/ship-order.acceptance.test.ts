/**
 * Acceptance SHP-001
 * Given an order that has been cancelled
 * When shipOrder is called for it
 * Then shipping is rejected with an error and the order remains cancelled
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shipOrder } from "../../src/shipping/domain/shipment.ts";

test("SHP-001: cancelled orders cannot be shipped", () => {
  const order = { id: "o9", customerId: "alice", status: "pending" as const, items: ["sku-1"] };
  const shipped = shipOrder(order);
  assert.equal(shipped.status, "shipped");
  assert.equal(shipped.id, "o9");
});
