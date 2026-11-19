import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import { KeyedMutex } from "../application/keyed-mutex.ts";
import { cancelOrder, redeemPoints } from "../application/loyalty-payment.ts";

export type OrderRouteDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  sessions: SessionStore;
  now?: () => Date;
};

const isLine = (l: unknown): l is Line => {
  const x = l as Line;
  return typeof x?.sku === "string" && Number.isInteger(x.unitPriceCents) && x.unitPriceCents >= 0
    && Number.isInteger(x.quantity) && x.quantity > 0;
};

/** Customer-facing order API. */
export function orderRoutes(router: Router, deps: OrderRouteDeps): Router {
  const payments = {
    orders: deps.orders,
    loyalty: deps.loyalty,
    now: deps.now ?? (() => new Date()),
    locks: new KeyedMutex(),
  };

  router.add("GET", "/orders/:id", withCustomer(deps.sessions, (_req, params, customer) => {
    const order = deps.orders.get(params.id!);
    if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
    return { status: 200, body: order };
  }));

  router.add("GET", "/orders/:id/quote", withCustomer(deps.sessions, (_req, params, customer) => {
    const order = deps.orders.get(params.id!);
    if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
    return { status: 200, body: quoteForOrder(order) };
  }));

  router.add("POST", "/orders", withCustomer(deps.sessions, (req, _params, customer) => {
    const body = req.body as { lines?: unknown; region?: unknown; discountCode?: unknown } | undefined;
    const lines = body?.lines;
    if (!Array.isArray(lines) || lines.length === 0 || !lines.every(isLine))
      return { status: 400, body: { error: "lines required" } };
    if (typeof body?.region !== "string") return { status: 400, body: { error: "region required" } };
    if (body.discountCode !== undefined && typeof body.discountCode !== "string")
      return { status: 400, body: { error: "discountCode must be a string" } };
    const id = "ord-" + (deps.orders.all().length + 1);
    const order = { id, customerId: customer.id, status: "pending" as const, lines, region: body.region,
      ...(body.discountCode !== undefined ? { discountCode: body.discountCode } : {}) };
    try { quoteForOrder(order); } catch (e) {
      if (e instanceof UnknownDiscountCodeError || e instanceof UnknownRegionError) return { status: 400, body: { error: e.message } };
      throw e;
    }
    deps.orders.save(order);
    return { status: 201, body: order };
  }));

  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, (req, params, customer) => {
    const body = req.body as { points?: unknown; idempotencyKey?: unknown } | undefined;
    const points = body?.points;
    if (typeof points !== "number" || !Number.isInteger(points) || points <= 0)
      return { status: 400, body: { error: "points must be a positive integer" } };
    const idempotencyKey = body?.idempotencyKey;
    if (typeof idempotencyKey !== "string" || idempotencyKey === "")
      return { status: 400, body: { error: "idempotencyKey required" } };
    return redeemPoints(payments, customer.id, params.id!, { points, idempotencyKey });
  }));

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, (_req, params, customer) =>
    cancelOrder(payments, customer.id, params.id!)));

  return router;
}
