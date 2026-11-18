import { mergeOrders, OrderStateError } from "../domain/order.ts";
import { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
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

  router.add("POST", "/orders/merge", withCustomer(deps.sessions, (req, _params, customer) => {
    const body = req.body as { sourceId?: unknown; targetId?: unknown } | undefined;
    const sourceId = body?.sourceId, targetId = body?.targetId;
    if (typeof sourceId !== "string" || !sourceId.length || typeof targetId !== "string" || !targetId.length)
      return { status: 400, body: { error: "sourceId and targetId required" } };
    const source = deps.orders.get(sourceId), target = deps.orders.get(targetId);
    if (!source || !target || source.customerId !== customer.id || target.customerId !== customer.id)
      return { status: 404, body: { error: "order not found" } };
    try {
      const merged = mergeOrders(source, target);
      deps.orders.save(merged.target);
      deps.orders.save(merged.source);
      return { status: 200, body: merged.target };
    } catch (error) {
      if (error instanceof OrderStateError) return { status: 409, body: { error: error.message } };
      throw error;
    }
  }));

  return router;
}
