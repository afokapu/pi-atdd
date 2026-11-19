import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import { consumeEarliestLots, isExpired } from "../../loyalty/domain/points.ts";
import { cancel, OrderStateError, type Order } from "../domain/order.ts";
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

function redeemedPoints(order: Order): number {
  return (order.redemptions ?? []).reduce((total, redemption) => total + redemption.appliedPoints, 0);
}

function validRedeemBody(body: RedeemBody | undefined): body is { points: number; idempotencyKey: string } {
  return Number.isInteger(body?.points) && body.points! > 0
    && typeof body.idempotencyKey === "string" && body.idempotencyKey.length > 0;
}

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
    if (!validRedeemBody(body)) return { status: 400, body: { error: "valid points and idempotencyKey required" } };
    return deps.loyalty.transactCustomer(customer.id, lots => {
      const order = deps.orders.get(params.id!);
      if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
      const previous = (order.redemptions ?? []).find(redemption => redemption.idempotencyKey === body.idempotencyKey);
      if (previous) {
        if (previous.requestedPoints !== body.points)
          return { status: 409, body: { error: "idempotency key was used with a different body" } };
        return { status: 200, body: quoteForOrderWithPoints(order, previous.pointsAppliedAfter) };
      }
      if (order.status !== "pending") return { status: 409, body: { error: "order is not pending" } };
      const undiscountedBalance = quoteForOrder(order).subtotalCents - quoteForOrder(order).discountCents;
      const requested = Math.min(body.points, undiscountedBalance - redeemedPoints(order));
      const allocations = consumeEarliestLots(lots, Math.max(0, requested), deps.now());
      const appliedPoints = allocations.reduce((total, allocation) => total + allocation.points, 0);
      const pointsAppliedAfter = redeemedPoints(order) + appliedPoints;
      const redeemed = { ...order, redemptions: [...(order.redemptions ?? []), {
        idempotencyKey: body.idempotencyKey, requestedPoints: body.points, appliedPoints, pointsAppliedAfter, lots: allocations,
      }] };
      deps.orders.save(redeemed);
      return { status: 200, body: quoteForOrderWithPoints(redeemed, redeemedPoints(redeemed)) };
    });
  }));

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, async (_req, params, customer) => {
    return deps.loyalty.transactCustomer(customer.id, lots => {
      const order = deps.orders.get(params.id!);
      if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
      try {
        const cancelled = cancel(order);
        for (const redemption of order.redemptions ?? []) {
          for (const allocation of redemption.lots) {
            if (isExpired({ id: allocation.lotId, customerId: customer.id, points: 0, expiresAt: allocation.expiresAt }, deps.now())) continue;
            const lot = lots.find(candidate => candidate.id === allocation.lotId);
            if (lot) {
              lot.points += allocation.points;
              lot.expiresAt = new Date(allocation.expiresAt.getTime());
            }
          }
        }
        deps.orders.save(cancelled);
        return { status: 200, body: cancelled };
      } catch (e) {
        if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
        throw e;
      }
    });
  }));

  return router;
}
