/** Held-out evaluator oracle for task T1-SEC / ORD-CANCEL-001 (negative authorization witnesses). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../src/http/router.ts";
import { orderRoutes } from "../src/orders/routes/order-routes.ts";
import { InMemoryOrderStore } from "../src/orders/integration/order-store.ts";

function world() {
  const orders = new InMemoryOrderStore([
    { id: "o1", customerId: "alice", status: "pending", items: ["a"] },
    { id: "o2", customerId: "alice", status: "shipped", items: ["b"] },
    { id: "o3", customerId: "bob", status: "pending", items: ["c"] },
  ]);
  const tokens: Record<string, string> = { "t-alice": "alice", "t-bob": "bob" };
  const sessions = { lookup: (t: string) => (tokens[t] ? { id: tokens[t]! } : undefined) };
  return { orders, router: orderRoutes(new Router(), { orders, sessions }) };
}
const post = (path: string, headers: Record<string, string> = {}) => ({ method: "POST" as const, path, headers });

test("oracle: owner cancels pending order -> 200 and cancelled", () => {
  const w = world();
  const r = w.router.handle(post("/orders/o1/cancel", { authorization: "Bearer t-alice" }));
  assert.equal(r.status, 200);
  assert.equal(w.orders.get("o1")!.status, "cancelled");
});
test("oracle: unauthenticated cancel -> 401 and no mutation", () => {
  const w = world();
  const r = w.router.handle(post("/orders/o1/cancel"));
  assert.equal(r.status, 401);
  assert.equal(w.orders.get("o1")!.status, "pending");
});
test("oracle: invalid bearer token -> 401 and no mutation", () => {
  const w = world();
  const r = w.router.handle(post("/orders/o1/cancel", { authorization: "Bearer forged" }));
  assert.equal(r.status, 401);
  assert.equal(w.orders.get("o1")!.status, "pending");
});
test("oracle: another customer's order -> 403/404 and no mutation", () => {
  const w = world();
  const r = w.router.handle(post("/orders/o3/cancel", { authorization: "Bearer t-alice" }));
  assert.ok(r.status === 403 || r.status === 404, "status " + r.status);
  assert.equal(w.orders.get("o3")!.status, "pending");
});
test("oracle: shipped order cannot be cancelled -> 4xx and no mutation", () => {
  const w = world();
  const r = w.router.handle(post("/orders/o2/cancel", { authorization: "Bearer t-alice" }));
  assert.ok(r.status >= 400 && r.status < 500 && r.status !== 401, "status " + r.status);
  assert.equal(w.orders.get("o2")!.status, "shipped");
});
test("oracle: unknown order -> 404", () => {
  const w = world();
  const r = w.router.handle(post("/orders/nope/cancel", { authorization: "Bearer t-alice" }));
  assert.equal(r.status, 404);
});
test("oracle: existing GET behaviour preserved", () => {
  const w = world();
  assert.equal(w.router.handle({ method: "GET", path: "/orders/o1", headers: { authorization: "Bearer t-alice" } }).status, 200);
  assert.equal(w.router.handle({ method: "GET", path: "/orders/o1", headers: {} }).status, 401);
});
