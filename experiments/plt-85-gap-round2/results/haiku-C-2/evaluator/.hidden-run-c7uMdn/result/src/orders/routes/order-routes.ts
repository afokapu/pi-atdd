import type { Router, Response } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import type { CustomerLock } from "../../loyalty/application/customer-lock.ts";
import { InsufficientPointsError } from "../../loyalty/domain/points.ts";
import { OrderStateError } from "../domain/order.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";
import {
  cancelOrder, OrderNotFoundError, redeemPoints, RedemptionConflictError,
} from "../application/order-redemption.ts";

export type OrderRouteDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  locks: CustomerLock;
  sessions: SessionStore;
  now: () => Date;
};

const isLine = (l: unknown): l is Line => {
  const x = l as Line;
  return typeof x?.sku === "string" && Number.isInteger(x.unitPriceCents) && x.unitPriceCents >= 0
    && Number.isInteger(x.quantity) && x.quantity > 0;
};

/** Map application failures to HTTP responses. Anything unexpected is rethrown. */
function failure(e: unknown): Response {
  if (e instanceof OrderNotFoundError) return { status: 404, body: { error: e.message } };
  if (e instanceof OrderStateError || e instanceof RedemptionConflictError || e instanceof InsufficientPointsError)
    return { status: 409, body: { error: e.message } };
  if (e instanceof UnknownDiscountCodeError || e instanceof UnknownRegionError) return { status: 400, body: { error: e.message } };
  throw e;
}

function parseRedeemBody(body: unknown): { points: number; idempotencyKey: string } | undefined {
  const { points, idempotencyKey } = (body ?? {}) as { points?: unknown; idempotencyKey?: unknown };
  if (typeof points !== "number" || !Number.isInteger(points) || points < 1) return undefined;
  if (typeof idempotencyKey !== "string" || idempotencyKey === "") return undefined;
  return { points, idempotencyKey };
}

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

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, async (_req, params, customer) => {
    try {
      const cancelled = await cancelOrder(deps, params.id!, customer.id);
      return { status: 200, body: cancelled };
    } catch (e) { return failure(e); }
  }));

  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, async (req, params, customer) => {
    const input = parseRedeemBody(req.body);
    if (!input) return { status: 400, body: { error: "points (positive integer) and idempotencyKey (non-empty string) required" } };
    try {
      const { quote } = await redeemPoints(deps, { orderId: params.id!, customerId: customer.id, ...input });
      return { status: 200, body: quote };
    } catch (e) { return failure(e); }
  }));

  return router;
}
