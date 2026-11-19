import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { IdempotencyConflictError, type InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import { cancel, OrderStateError } from "../domain/order.ts";
import { quoteForOrder, quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";

export type OrderRouteDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  sessions: SessionStore;
  now: () => Date;
};

type RedeemBody = { points?: unknown; idempotencyKey?: unknown };

const redeemedPoints = (order: { redemptions?: { points: number }[] }): number =>
  order.redemptions?.reduce((total, redemption) => total + redemption.points, 0) ?? 0;

const isRedeemBody = (body: RedeemBody | undefined): body is { points: number; idempotencyKey: string } =>
  Number.isInteger(body?.points) && (body.points as number) >= 0
  && typeof body?.idempotencyKey === "string" && body.idempotencyKey.length > 0;

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

  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, async (req, params, customer) => {
    const body = req.body as RedeemBody | undefined;
    if (!isRedeemBody(body)) return { status: 400, body: { error: "points and idempotencyKey are required" } };
    const initial = deps.orders.get(params.id!);
    if (!initial || initial.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
    try {
      await deps.loyalty.redeem(customer.id, { orderId: initial.id, ...body }, deps.now(), () => {
        const current = deps.orders.get(initial.id)!;
        if (current.status !== "pending") throw new OrderStateError("order " + current.id + " is " + current.status);
        const quote = quoteForOrderWithPoints(current, redeemedPoints(current));
        return quote.subtotalCents - quote.discountCents - quote.pointsAppliedCents;
      }, allocations => {
        const current = deps.orders.get(initial.id)!;
        deps.orders.save({ ...current, redemptions: [...(current.redemptions ?? []), { ...body, allocations }] });
      });
      const redeemed = deps.orders.get(initial.id)!;
      return { status: 200, body: quoteForOrderWithPoints(redeemed, redeemedPoints(redeemed)) };
    } catch (error) {
      if (error instanceof IdempotencyConflictError || error instanceof OrderStateError)
        return { status: 409, body: { error: error.message } };
      throw error;
    }
  }));

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, async (_req, params, customer) => {
    const order = deps.orders.get(params.id!);
    if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
    try {
      const cancelled = cancel(order);
      // Persist cancellation before awaiting the ledger so a concurrent redemption is rejected.
      deps.orders.save(cancelled);
      const allocations = cancelled.redemptions?.flatMap(redemption => redemption.allocations) ?? [];
      await deps.loyalty.restore(customer.id, allocations, deps.now());
      return { status: 200, body: cancelled };
    } catch (e) {
      if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
      throw e;
    }
  }));

  return router;
}
