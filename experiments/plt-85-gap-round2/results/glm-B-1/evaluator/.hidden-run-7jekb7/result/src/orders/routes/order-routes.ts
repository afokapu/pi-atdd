/**
 * Customer-facing order API. Every route requires a signed-in customer and
 * only ever exposes orders the customer owns; redeem/cancel delegation goes
 * through the application-layer RedeemService so ledger rules live in one
 * place (the route itself only validates and maps to HTTP statuses).
 */
import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { RedeemService } from "../application/redeem-service.ts";
import { cancel, OrderStateError } from "../domain/order.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";

export type OrderRouteDeps = { orders: InMemoryOrderStore; sessions: SessionStore; redeem: RedeemService };

// Body guard for cart lines: price and quantity must be whole, non-negative cents / positive counts.
const isLine = (l: unknown): l is Line => {
  const x = l as Line;
  return typeof x?.sku === "string" && Number.isInteger(x.unitPriceCents) && x.unitPriceCents >= 0
    && Number.isInteger(x.quantity) && x.quantity > 0;
};

/** Customer-facing order API. */
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
    const lines = body?.lines;
    if (!Array.isArray(lines) || lines.length === 0 || !lines.every(isLine))
      return { status: 400, body: { error: "lines required" } };
    if (typeof body?.region !== "string") return { status: 400, body: { error: "region required" } };
    if (body.discountCode !== undefined && typeof body.discountCode !== "string")
      return { status: 400, body: { error: "discountCode must be a string" } };
    // Ids derive from the store size; fine for this single-process demo service.
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
    const order = deps.orders.get(params.id!);
    if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
    try {
      const cancelled = cancel(order);
      // Points return to their original lots before the cancelled order is stored;
      // the service serialises this against concurrent redemptions of the same customer.
      await deps.redeem.refundFor(cancelled);
      deps.orders.save(cancelled);
      return { status: 200, body: cancelled };
    } catch (e) {
      if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
      throw e;
    }
  }));

  // LOY-002: pay part of a pending order with points. Validation is HTTP's job;
  // consumption, idempotency and concurrency live in RedeemService.
  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, (req, params, customer) => {
    const order = deps.orders.get(params.id!);
    if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
    const body = req.body as { points?: unknown; idempotencyKey?: unknown } | undefined;
    if (!Number.isInteger(body?.points) || (body!.points as number) <= 0)
      return { status: 400, body: { error: "points must be a positive integer" } };
    if (typeof body?.idempotencyKey !== "string" || body.idempotencyKey === "")
      return { status: 400, body: { error: "idempotencyKey must be a non-empty string" } };
    return deps.redeem.redeemFor(order, body.points as number, body.idempotencyKey);
  }));

  return router;
}
