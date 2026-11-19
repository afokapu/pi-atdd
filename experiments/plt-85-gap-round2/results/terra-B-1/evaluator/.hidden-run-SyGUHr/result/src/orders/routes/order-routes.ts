import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { cancel, redeem, OrderStateError } from "../domain/order.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import { IdempotencyConflictError } from "../../loyalty/integration/loyalty-store.ts";
import { quoteForOrder, quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";

export type OrderRouteDeps = { orders: InMemoryOrderStore; loyalty: InMemoryLoyaltyStore; sessions: SessionStore; now: () => Date };

type RedeemBody = { points?: unknown; idempotencyKey?: unknown };

/** A valid body is deliberately narrow: idempotency requires an exact points request. */
function redeemRequest(body: unknown): { points: number; idempotencyKey: string } | undefined {
  const candidate = body as RedeemBody | undefined;
  if (!Number.isInteger(candidate?.points) || (candidate.points as number) < 0) return undefined;
  if (typeof candidate.idempotencyKey !== "string" || candidate.idempotencyKey.length === 0) return undefined;
  return { points: candidate.points as number, idempotencyKey: candidate.idempotencyKey };
}

function redemptionError(error: unknown): { status: number; body: unknown } | undefined {
  if (error instanceof IdempotencyConflictError) return { status: 409, body: { error_code: "IDEMPOTENCY_KEY_REUSED" } };
  if (error instanceof OrderStateError) return { status: 409, body: { error_code: "ORDER_NOT_PENDING" } };
  return undefined;
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
    const request = redeemRequest(req.body);
    if (!request) return { status: 400, body: { error_code: "INVALID_REDEMPTION" } };
    return deps.orders.exclusively(params.id!, async () => {
      const order = deps.orders.get(params.id!);
      if (!order || order.customerId !== customer.id) return { status: 404, body: { error_code: "ORDER_NOT_FOUND" } };
      try {
        if (order.status !== "pending" && order.status !== "redeemed") throw new OrderStateError();
        if (order.status === "redeemed") {
          const prior = await deps.loyalty.redemptionFor(customer.id, request.idempotencyKey);
          if (!prior) throw new OrderStateError();
          if (prior.orderId !== order.id || prior.requestedPoints !== request.points)
            throw new IdempotencyConflictError("idempotency key was used with a different body");
          return { status: 200, body: quoteForOrderWithPoints(order, prior.appliedPoints) };
        }
        const ordinaryQuote = quoteForOrder(order);
        const maximumPoints = ordinaryQuote.subtotalCents - ordinaryQuote.discountCents;
        const appliedPoints = await deps.loyalty.redeem(customer.id, order.id, request.idempotencyKey,
          request.points, maximumPoints, deps.now());
        deps.orders.save(redeem(order));
        return { status: 200, body: quoteForOrderWithPoints(order, appliedPoints) };
      } catch (error) {
        const response = redemptionError(error);
        if (response) return response;
        throw error;
      }
    });
  }));

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, async (_req, params, customer) => {
    return deps.orders.exclusively(params.id!, async () => {
      const order = deps.orders.get(params.id!);
      if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
      try {
        const cancelled = cancel(order);
        if (order.status === "redeemed") await deps.loyalty.refundOrder(customer.id, order.id, deps.now());
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
