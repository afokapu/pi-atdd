import type { Response, Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { OrderStateError } from "../domain/order.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";
import {
  AlreadyRedeemedError, cancelOrder, IdempotencyConflictError, InsufficientPointsError,
  OrderNotFoundError, redeemPoints, type PaymentDeps,
} from "../application/order-payments.ts";

export type OrderRouteDeps = { orders: InMemoryOrderStore; sessions: SessionStore; payments: PaymentDeps };

type RedeemBody = { points: number; idempotencyKey: string };

/** Validates the redeem body: `points` a positive integer, `idempotencyKey` a non-empty string. */
const parseRedeemBody = (body: unknown): RedeemBody | undefined => {
  const b = (body ?? {}) as { points?: unknown; idempotencyKey?: unknown };
  if (!Number.isInteger(b.points) || (b.points as number) <= 0) return undefined;
  if (typeof b.idempotencyKey !== "string" || b.idempotencyKey === "") return undefined;
  return { points: b.points as number, idempotencyKey: b.idempotencyKey };
};

const failure = (status: number, code: string, e: Error): Response => ({ status, body: { error_code: code, error: e.message } });

/** Maps application failures to responses. Anything unexpected is rethrown, not hidden as a 4xx. */
function failureResponse(e: unknown): Response {
  if (e instanceof OrderNotFoundError) return failure(404, "ORDER_NOT_FOUND", e);
  if (e instanceof OrderStateError) return failure(409, "ORDER_NOT_PENDING", e);
  if (e instanceof AlreadyRedeemedError) return failure(409, "ORDER_ALREADY_REDEEMED", e);
  if (e instanceof InsufficientPointsError) return failure(409, "INSUFFICIENT_POINTS", e);
  if (e instanceof IdempotencyConflictError) return failure(422, "IDEMPOTENCY_KEY_REUSED", e);
  if (e instanceof UnknownRegionError) return failure(400, "UNKNOWN_REGION", e);
  throw e;
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

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, async (_req, params, customer) => {
    try {
      return { status: 200, body: await cancelOrder(deps.payments, customer.id, params.id!) };
    } catch (e) {
      return failureResponse(e);
    }
  }));

  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, async (req, params, customer) => {
    const body = parseRedeemBody(req.body);
    if (!body) return { status: 400, body: { error_code: "INVALID_REDEMPTION", error: "points (positive integer) and idempotencyKey (string) required" } };
    try {
      const quote = await redeemPoints(deps.payments, { customerId: customer.id, orderId: params.id!, ...body });
      return { status: 200, body: quote };
    } catch (e) {
      return failureResponse(e);
    }
  }));

  return router;
}
