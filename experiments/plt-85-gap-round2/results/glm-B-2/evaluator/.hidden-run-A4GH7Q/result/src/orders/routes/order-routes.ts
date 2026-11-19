import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { OrderStateError } from "../domain/order.ts";
import type { RedeemService } from "../application/redeem-service.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";

export type OrderRouteDeps = { orders: InMemoryOrderStore; sessions: SessionStore; redeem: RedeemService };

const isLine = (l: unknown): l is Line => {
  // A line is valid only with a positive integer quantity and a non-negative
  // integer unit price; everything else is a bad request, not a server error.
  const x = l as Line;
  return typeof x?.sku === "string" && Number.isInteger(x.unitPriceCents) && x.unitPriceCents >= 0
    && Number.isInteger(x.quantity) && x.quantity > 0;
};

/**
 * Customer-facing order API: create, inspect, quote, redeem loyalty points
 * against, and cancel orders. Every mutating route goes through
 * `withCustomer` first; owned-order checks are always `404` (never `403`)
 * so the existence of other customers' orders does not leak.
 */
export function orderRoutes(router: Router, deps: OrderRouteDeps): Router {
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
    // Shape first (400), then referential validity via a trial quote so an
    // unknown region or discount code is rejected before anything is stored.
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

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, async (_req, params, customer) => {
    try {
      // The service cancels and refunds redeemed points under the customer's
      // lock, so a concurrent redemption cannot race the refund.
      const result = await deps.redeem.cancelOrder({ orderId: params.id!, customerId: customer.id });
      return result.ok ? { status: 200, body: result.order } : { status: result.status, body: { error: result.error } };
    } catch (e) {
      if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
      throw e;
    }
  }));

  // Pays part of a pending order with loyalty points. Body { points,
  // idempotencyKey }: the same key with the same request replays the original
  // quote without consuming again, the same key with a different request is a
  // 409. Ledger mutations are serialized per customer inside the service.
  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, async (req, params, customer) => {
    const body = (req.body ?? {}) as { points?: unknown; idempotencyKey?: unknown };
    if (!Number.isInteger(body.points) || (body.points as number) < 1)
      return { status: 400, body: { error: "points must be a positive integer" } };
    if (typeof body.idempotencyKey !== "string" || body.idempotencyKey === "")
      return { status: 400, body: { error: "idempotencyKey required" } };
    const result = await deps.redeem.redeem({
      orderId: params.id!,
      customerId: customer.id,
      points: body.points as number,
      idempotencyKey: body.idempotencyKey,
    });
    return result.ok ? { status: 200, body: result.quote } : { status: result.status, body: { error: result.error } };
  }));

  return router;
}
