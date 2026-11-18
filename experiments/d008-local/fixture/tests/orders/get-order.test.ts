import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice } from "./helpers.ts";

test("a customer can read their own order", () => {
  const { router } = app([{ id: "o1", customerId: "alice", status: "pending", items: ["sku-1"] }]);
  const res = router.handle({ method: "GET", path: "/orders/o1", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal((res.body as { id: string }).id, "o1");
});
