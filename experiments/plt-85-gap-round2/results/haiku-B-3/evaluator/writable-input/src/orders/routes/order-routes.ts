import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { cancel, OrderStateError } from "../domain/order.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import { redeemPoints, reverseRedemption, type LoyaltyDeps } from "../../loyalty/application/redemption-service.ts";
import { withCustomerLedger } from "../../loyalty/application/ledger-lock.ts";

export type OrderRouteDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  sessions: SessionStore;
  now: () => Date;
};

const isLine = (l: unknown): l is Line => {
  const x = l as Line;
  return typeof x?.sku === "string" && Number.isInteger(x.unitPriceCents) && x.unitPriceCents >= 0
    && Number.isInteger(x.quantity) && x.quantity > 0;
};

const isPositiveInteger = (x: unknown): x is number => Number.isInteger(x) && (x as number) > 0;

/**
 * Validate the redeem body; `undefined` means the request is malformed. Points must be a
 * positive whole number: zero-point requests are rejected rather than silently treated as no-ops.
 */
function parseRedeemBody(body: unknown): { points: number; idempotencyKey: string } | undefined {
  const b = (body ?? {}) as { points?: unknown; idempotencyKey?: unknown };
  const key = b.idempotencyKey;
  if (!isPositiveInteger(b.points) || typeof key !== "string" || key === "") return undefined;
  return { points: b.points, idempotencyKey: key };
}

/**
 * Customer-facing order API. Mutations that touch loyalty lots (cancel, redeem) run
 * inside the customer's ledger lock so concurrent requests cannot spend the same points.
 */
export function orderRoutes(router: Router, deps: OrderRouteDeps): Router {
  const loyalty: LoyaltyDeps = { loyalty: deps.loyalty, now: deps.now };

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

  // Reversal runs before the order is saved as cancelled. Both happen under the lock, so a
  // second cancel of the same order sees status "cancelled" and cannot return points twice.
  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, (_req, params, customer) =>
    withCustomerLedger(customer.id, async () => {
      const order = deps.orders.get(params.id!);
      if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
      try {
        const cancelled = cancel(order);
        await reverseRedemption(loyalty, order.id);
        deps.orders.save(cancelled);
        return { status: 200, body: cancelled };
      } catch (e) {
        if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
        throw e;
      }
    })));

  // Malformed input is 400. A refused redemption is 409 with a stable error_code that the
  // client can branch on; a replayed idempotency key returns the original 200 result instead.
  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, (req, params, customer) => {
    const body = parseRedeemBody(req.body);
    if (!body) return { status: 400, body: { error: "points and idempotencyKey required", error_code: "REDEMPTION_INVALID" } };
    return withCustomerLedger(customer.id, async () => {
      const order = deps.orders.get(params.id!);
      if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
      const outcome = await redeemPoints(loyalty, { customerId: customer.id, order, ...body });
      if (!outcome.ok) return { status: 409, body: { error_code: outcome.errorCode } };
      return { status: 200, body: outcome.quote };
    });
  }));

  return router;
}
