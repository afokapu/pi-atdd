import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { cancel, OrderStateError } from "../domain/order.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";
import { RedeemService, IdempotencyConflictError, OrderNotFoundError } from "../application/redeem-service.ts";

export type OrderRouteDeps = {
  orders: InMemoryOrderStore;
  sessions: SessionStore;
  /** Redeem use case (and per-customer locks); built by the composition root. */
  redeem: RedeemService;
};

const isLine = (l: unknown): l is Line => {
  const x = l as Line;
  return typeof x?.sku === "string" && Number.isInteger(x.unitPriceCents) && x.unitPriceCents >= 0
    && Number.isInteger(x.quantity) && x.quantity > 0;
};

/** Customer-facing order API. */
export function orderRoutes(router: Router, deps: OrderRouteDeps): Router {
  const redeem = deps.redeem;
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

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, (_req, params, customer) =>
    // Cancel + refund runs under the same per-customer lock as redemption,
    // so a concurrent redeem can never pay with points of an order being cancelled.
    redeem.runExclusive(customer.id, async () => {
      const order = deps.orders.get(params.id!);
      if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
      try {
        const cancelled = cancel(order);
        await redeem.refundOrder(cancelled);
        deps.orders.save(cancelled);
        return { status: 200, body: cancelled };
      } catch (e) {
        if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
        throw e;
      }
    })
  ));

  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, (req, params, customer) => {
    const body = req.body as { points?: unknown; idempotencyKey?: unknown } | undefined;
    const points = body?.points;
    const idempotencyKey = body?.idempotencyKey;
    if (!Number.isInteger(points) || (points as number) <= 0)
      return { status: 400, body: { error: "points must be a positive integer" } };
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0)
      return { status: 400, body: { error: "idempotencyKey required" } };
    return redeem.redeem(customer, params.id!, { points: points as number, idempotencyKey }).then(
      quote => ({ status: 200, body: quote }),
      e => {
        if (e instanceof OrderNotFoundError) return { status: 404, body: { error: e.message } };
        if (e instanceof OrderStateError || e instanceof IdempotencyConflictError) return { status: 409, body: { error: e.message } };
        if (e instanceof UnknownDiscountCodeError || e instanceof UnknownRegionError) return { status: 400, body: { error: e.message } };
        throw e;
      },
    );
  }));

  return router;
}
