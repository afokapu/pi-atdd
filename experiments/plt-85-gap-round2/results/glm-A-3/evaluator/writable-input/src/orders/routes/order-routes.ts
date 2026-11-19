import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { cancel, OrderStateError } from "../domain/order.ts";
import { quoteForCartWithPoints, quoteForOrder } from "../../pricing/application/quote-service.ts";
import { discountedSubtotal, UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { subtotal } from "../../pricing/domain/quote.ts";
import { pointsToCents } from "../../loyalty/domain/points.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";
import type { RedeemService } from "../application/redeem-service.ts";

export type OrderRouteDeps = { orders: InMemoryOrderStore; sessions: SessionStore; redeem: RedeemService };

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
    if (typeof body?.idempotencyKey !== "string" || body.idempotencyKey.length === 0)
      return { status: 400, body: { error: "idempotencyKey required" } };
    if (typeof body?.points !== "number" || !Number.isInteger(body.points) || body.points <= 0)
      return { status: 400, body: { error: "points must be a positive integer" } };
    const order = deps.orders.get(params.id!);
    if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
    if (order.status !== "pending") return { status: 409, body: { error: "order " + order.id + " is " + order.status } };
    return deps.redeem.redeem({
      customerId: customer.id,
      orderId: order.id,
      points: body.points,
      idempotencyKey: body.idempotencyKey,
      maxRedeemableCents: discountedSubtotal(subtotal(order.lines), order.discountCode),
      quoteFor: totalPoints =>
        quoteForCartWithPoints(order.lines, order.region, order.discountCode, pointsToCents(totalPoints)),
    }).then(outcome => {
      if (outcome.kind === "notFound") return { status: 404, body: { error: "order not found" } };
      if (outcome.kind === "conflict") return { status: 409, body: { error: outcome.error } };
      return { status: 200, body: outcome.quote };
    });
  }));

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, (_req, params, customer) =>
    // Hold the customer lock for the whole read-modify-write so a concurrent
    // redemption cannot commit between reading the order and refunding it.
    deps.redeem.runExclusive(customer.id, async () => {
      const order = deps.orders.get(params.id!);
      if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
      try {
        const cancelled = cancel(order);
        await deps.redeem.refundRedemption(cancelled);
        deps.orders.save(cancelled);
        return { status: 200, body: cancelled };
      } catch (e) {
        if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
        throw e;
      }
    })
  ));

  return router;
}
