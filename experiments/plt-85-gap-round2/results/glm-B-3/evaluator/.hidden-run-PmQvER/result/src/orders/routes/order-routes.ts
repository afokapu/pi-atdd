import type { Router, Request, Response, Params } from "../../http/router.ts";
import { withCustomer, type SessionStore, type Customer } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { cancel, OrderStateError } from "../domain/order.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";
import { type RedemptionService, type RedeemOutcome } from "../../loyalty/application/redeem-points.ts";

export type OrderRouteDeps = { orders: InMemoryOrderStore; sessions: SessionStore; redemptions: RedemptionService };

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

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, (_req, params, customer) => cancelOrder(params, customer, deps)));

  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, (req, params, customer) => redeemOrder(req, params, customer, deps)));

  return router;
}

/**
 * Cancel inside the customer's ledger transaction: the status flip and the
 * refund of any redeemed points are atomic against concurrent redemptions for
 * the same customer. Cancelling a redeemed order returns its points to their
 * original lots (expired lots' points are forfeited by the refund rule).
 */
async function cancelOrder(params: Params, customer: Customer, deps: OrderRouteDeps): Promise<Response> {
  return deps.redemptions.inLedgerTransaction(customer.id, async () => {
    const order = deps.orders.get(params.id!);
    if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
    try {
      const cancelled = cancel(order);
      deps.orders.save(cancelled);
      await deps.redemptions.refundForOrder(order.id);
      return { status: 200, body: cancelled };
    } catch (e) {
      if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
      throw e;
    }
  });
}

/** POST /orders/:id/redeem: pay part of a pending order with loyalty points. */
async function redeemOrder(req: Request, params: Params, customer: Customer, deps: OrderRouteDeps): Promise<Response> {
  const parsed = parseRedeemBody(req.body);
  if ("error" in parsed) return { status: 400, body: { error: parsed.error } };
  try {
    const outcome = await deps.redemptions.redeem(customer.id, params.id!, parsed.points, parsed.idempotencyKey);
    return redeemResponse(outcome);
  } catch (e) {
    if (e instanceof UnknownDiscountCodeError || e instanceof UnknownRegionError) return { status: 400, body: { error: e.message } };
    throw e;
  }
}

/** Map a redemption outcome onto the HTTP response. */
function redeemResponse(outcome: RedeemOutcome): Response {
  switch (outcome.kind) {
    case "ok": return { status: 200, body: outcome.quote };
    case "orderNotFound": return { status: 404, body: { error: "order not found" } };
    case "orderNotPending": return { status: 409, body: { error: outcome.message } };
    case "conflict": return { status: 409, body: { error: outcome.message } };
  }
}

type RedeemBody = { points: number; idempotencyKey: string };

/** Parse and validate the redeem request body; an `error` result is a 400. */
function parseRedeemBody(body: unknown): RedeemBody | { error: string } {
  const b = body as RedeemBody | undefined;
  if (!Number.isInteger(b?.points) || b!.points <= 0) return { error: "points must be a positive integer" };
  if (typeof b?.idempotencyKey !== "string" || b.idempotencyKey === "") return { error: "idempotencyKey must be a non-empty string" };
  return { points: b.points, idempotencyKey: b.idempotencyKey };
}
