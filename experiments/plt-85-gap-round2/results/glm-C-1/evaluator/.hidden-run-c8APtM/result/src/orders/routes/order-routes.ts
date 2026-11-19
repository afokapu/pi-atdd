import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import type { InMemoryIdempotencyStore } from "../integration/idempotency-store.ts";
import { OrderStateError } from "../domain/order.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import { redeemOrderPoints, type RedeemInput } from "../application/redeem-order.ts";
import { cancelOrder } from "../application/cancel-order.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";

export type OrderRouteDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  idempotency: InMemoryIdempotencyStore;
  sessions: SessionStore;
  /** Clock used for lot expiry and restoration decisions. */
  now: () => Date;
};

const isLine = (l: unknown): l is Line => {
  const x = l as Line;
  return typeof x?.sku === "string" && Number.isInteger(x.unitPriceCents) && x.unitPriceCents >= 0
    && Number.isInteger(x.quantity) && x.quantity > 0;
};

type RedeemBodyParse = { error: { status: number; body: unknown } } | { input: RedeemInput };

/** Validate the redeem body `{ points, idempotencyKey }`; 400 with the reason if invalid. */
function parseRedeemBody(body: unknown): RedeemBodyParse {
  const b = (body ?? {}) as { points?: unknown; idempotencyKey?: unknown };
  if (!Number.isInteger(b.points) || (b.points as number) < 1)
    return { error: { status: 400, body: { error: "points must be a positive integer" } } };
  if (typeof b.idempotencyKey !== "string" || b.idempotencyKey.length === 0)
    return { error: { status: 400, body: { error: "idempotencyKey must be a non-empty string" } } };
  return { input: { points: b.points as number, idempotencyKey: b.idempotencyKey } };
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

  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, async (req, params, customer) => {
    const parsed = parseRedeemBody(req.body);
    if ("error" in parsed) return parsed.error;
    try {
      // Ownership, eligibility, idempotency and consumption are decided
      // together inside the use case's per-customer critical section.
      return await redeemOrderPoints(deps, params.id!, customer.id, parsed.input);
    } catch (e) {
      if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
      if (e instanceof UnknownDiscountCodeError || e instanceof UnknownRegionError) return { status: 400, body: { error: e.message } };
      throw e;
    }
  }));

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, async (_req, params, customer) => {
    try {
      // Cancel and any point restoration run in one per-customer critical
      // section, so they cannot interleave with a concurrent redemption.
      return await cancelOrder(deps, params.id!, customer.id);
    } catch (e) {
      if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
      throw e;
    }
  }));

  return router;
}
