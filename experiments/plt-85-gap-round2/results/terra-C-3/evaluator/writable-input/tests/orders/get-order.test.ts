import { test } from "node:test";
import assert from "node:assert/strict";
import { app, asAlice, asBob, pendingOrder } from "./helpers.ts";

test("a customer can read their own order", async () => {
  const { router } = app([pendingOrder()]);
  const res = await router.handle({ method: "GET", path: "/orders/o1", headers: asAlice });
  assert.equal(res.status, 200);
  assert.equal((res.body as { id: string }).id, "o1");
});

test("another customer's order is not found", async () => {
  const { router } = app([pendingOrder()]);
  const res = await router.handle({ method: "GET", path: "/orders/o1", headers: asBob });
  assert.equal(res.status, 404);
});

test("quote of an order: discount before tax", async () => {
  const { router } = app([pendingOrder({ discountCode: "SAVE10" })]);
  const res = await router.handle({ method: "GET", path: "/orders/o1/quote", headers: asAlice });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { region: "DE", subtotalCents: 10000, discountCents: 1000, taxCents: 1710, totalCents: 10710 });
});
