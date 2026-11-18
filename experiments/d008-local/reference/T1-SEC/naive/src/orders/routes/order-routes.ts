import { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import { cancel } from "../domain/order.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";

export type OrderRouteDeps = { orders: InMemoryOrderStore; sessions: SessionStore };

/** Customer-facing order API. */
export function orderRoutes(router: Router, deps: OrderRouteDeps): Router {
  router.add("GET", "/orders/:id", withCustomer(deps.sessions, (_req, params, customer) => {
    const order = deps.orders.get(params.id!);
    if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
    return { status: 200, body: order };
  }));

  router.add("POST", "/orders", withCustomer(deps.sessions, (req, _params, customer) => {
    const items = (req.body as { items?: unknown })?.items;
    if (!Array.isArray(items) || !items.every(i => typeof i === "string") || items.length === 0)
      return { status: 400, body: { error: "items required" } };
    const id = "ord-" + (deps.orders.all().length + 1);
    const order = { id, customerId: customer.id, status: "pending" as const, items: items as string[] };
    deps.orders.save(order);
    return { status: 201, body: order };
  }));

  router.add("POST", "/orders/:id/cancel", (_req, params) => {
    const order = deps.orders.get(params.id!);
    if (!order) return { status: 404, body: { error: "order not found" } };
    deps.orders.save(cancel(order));
    return { status: 200, body: { ...order, status: "cancelled" } };
  });

  return router;
}
