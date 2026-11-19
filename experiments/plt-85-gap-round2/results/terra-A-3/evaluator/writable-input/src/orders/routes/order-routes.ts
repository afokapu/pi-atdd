import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import { IdempotencyConflictError } from "../../loyalty/integration/loyalty-store.ts";
import { cancel, OrderStateError } from "../domain/order.ts";
import { quoteForOrder, quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";

export type OrderRouteDeps = { orders: InMemoryOrderStore; loyalty: InMemoryLoyaltyStore; sessions: SessionStore; now?: () => Date };

const isLine = (l: unknown): l is Line => {
  const x = l as Line;
  return typeof x?.sku === "string" && Number.isInteger(x.unitPriceCents) && x.unitPriceCents >= 0
    && Number.isInteger(x.quantity) && x.quantity > 0;
};

/** Customer-facing order API. */
export function orderRoutes(router: Router, deps: OrderRouteDeps): Router {
  // Serializing order changes keeps cancellation from racing a pending redemption.
  const orderTails = new Map<string, Promise<void>>();
  const withOrderLock = async <T>(id: string, operation: () => Promise<T> | T): Promise<T> => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const previous = orderTails.get(id) ?? Promise.resolve();
    orderTails.set(id, previous.then(() => gate));
    await previous;
    try { return await operation(); } finally { release(); }
  };
  const now = () => deps.now ? deps.now() : new Date();

  router.add("GET", "/orders/:id", withCustomer(deps.sessions, (_req, params, customer) => {
    const order = deps.orders.get(params.id!);
    if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
    return { status: 200, body: order };
  }));

  router.add("GET", "/orders/:id/quote", withCustomer(deps.sessions, (_req, params, customer) => {
    const order = deps.orders.get(params.id!);
    if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
    return { status: 200, body: order.pointsAppliedCents
      ? quoteForOrderWithPoints(order, order.pointsAppliedCents) : quoteForOrder(order) };
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

  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, async (req, params, customer) =>
    withOrderLock(params.id!, async () => {
      const order = deps.orders.get(params.id!);
      if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
      if (order.status !== "pending") return { status: 409, body: { error: "order " + order.id + " is " + order.status } };
      const body = req.body as { points?: unknown; idempotencyKey?: unknown } | undefined;
      if (!Number.isInteger(body?.points) || (body.points as number) < 0)
        return { status: 400, body: { error: "points must be a non-negative integer" } };
      if (typeof body?.idempotencyKey !== "string" || body.idempotencyKey.length === 0)
        return { status: 400, body: { error: "idempotencyKey required" } };
      try {
        const beforePoints = quoteForOrder(order);
        const redemption = await deps.loyalty.redeem(customer.id, order.id, body.idempotencyKey, body.points as number,
          beforePoints.subtotalCents - beforePoints.discountCents, now());
        // Persist the current aggregate, while a repeated key returns its original quote.
        const updated = { ...order, pointsAppliedCents: redemption.currentOrderAppliedPoints };
        deps.orders.save(updated);
        return { status: 200, body: quoteForOrderWithPoints(updated, redemption.orderAppliedPoints) };
      } catch (e) {
        if (e instanceof IdempotencyConflictError) return { status: 409, body: { error: e.message } };
        throw e;
      }
    })
  ));

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, (_req, params, customer) =>
    withOrderLock(params.id!, async () => {
      const order = deps.orders.get(params.id!);
      if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
      try {
        const cancelled = cancel(order);
        await deps.loyalty.reverseOrder(customer.id, order.id, now());
        const saved = order.pointsAppliedCents ? { ...cancelled, pointsAppliedCents: 0 } : cancelled;
        deps.orders.save(saved);
        return { status: 200, body: saved };
      } catch (e) {
        if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
        throw e;
      }
    })
  ));

  return router;
}
