import type { Router, Request, Response } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import { OrderNotFoundError, OrderStateError } from "../domain/order.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import type { InMemoryRedemptionStore } from "../../loyalty/integration/redemption-store.ts";
import type { PerKeyLock } from "../application/per-key-lock.ts";
import { redeemForOrder, IdempotencyConflictError, InsufficientPointsError, type LedgerDeps } from "../application/redeem-points.ts";
import { cancelOrder } from "../application/cancel-order.ts";

/** Presentation deps: the ledger collaborators come pre-wired from the composition root. */
export type OrderRouteDeps = LedgerDeps & { sessions: SessionStore };

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

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, (_req, params, customer) =>
    cancelResponse(deps, params.id!, customer.id)));

  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, (req, params, customer) => {
    const parsed = parseRedeemBody(req.body);
    if ("status" in parsed) return parsed;
    return redeemResponse(deps, params.id!, customer.id, parsed);
  }));

  return router;
}

/** Valid `{ points, idempotencyKey }`, or the 400 response the route returns directly. */
function parseRedeemBody(body: unknown): { points: number; idempotencyKey: string } | Response {
  const b = body as { points?: unknown; idempotencyKey?: unknown } | undefined;
  if (!Number.isInteger(b?.points) || (b!.points as number) < 1)
    return { status: 400, body: { error_code: "POINTS_INVALID", error: "points must be a positive integer" } };
  if (typeof b?.idempotencyKey !== "string" || b.idempotencyKey.length === 0)
    return { status: 400, body: { error_code: "IDEMPOTENCY_KEY_REQUIRED", error: "idempotencyKey must be a non-empty string" } };
  return { points: b!.points as number, idempotencyKey: b!.idempotencyKey };
}

/** Redeem use case mapped to HTTP: success is the new quote; state and ledger conflicts are 4xx. */
async function redeemResponse(deps: LedgerDeps, orderId: string, customerId: string,
  cmd: { points: number; idempotencyKey: string }): Promise<Response> {
  try {
    const quote = await redeemForOrder(deps, { orderId, customerId, ...cmd });
    return { status: 200, body: quote };
  } catch (e) {
    if (e instanceof OrderNotFoundError) return { status: 404, body: { error: "order not found" } };
    if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
    if (e instanceof IdempotencyConflictError) return { status: 409, body: { error_code: "IDEMPOTENCY_CONFLICT", error: e.message } };
    if (e instanceof InsufficientPointsError) return { status: 409, body: { error_code: "INSUFFICIENT_POINTS", error: e.message } };
    throw e;
  }
}

/** Cancel use case mapped to HTTP; a redeemed order's points are restored by the use case itself. */
async function cancelResponse(deps: LedgerDeps, orderId: string, customerId: string): Promise<Response> {
  try {
    const outcome = await cancelOrder(deps, orderId, customerId);
    return { status: 200, body: outcome.order };
  } catch (e) {
    if (e instanceof OrderNotFoundError) return { status: 404, body: { error: "order not found" } };
    if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
    throw e;
  }
}
