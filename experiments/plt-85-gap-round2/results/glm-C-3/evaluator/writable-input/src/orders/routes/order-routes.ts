import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { cancelOrder } from "../application/cancel-order.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import { redeemPoints } from "../../loyalty/application/redeem-points.ts";
import { releaseOrderRedemptions } from "../../loyalty/application/release-points.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import type { InMemoryRedemptionStore } from "../../loyalty/integration/redemption-store.ts";
import type { OwnerLocks } from "../../loyalty/application/owner-locks.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";

export type OrderRouteDeps = {
  orders: InMemoryOrderStore;
  sessions: SessionStore;
  loyalty: InMemoryLoyaltyStore;
  redemptions: InMemoryRedemptionStore;
  /** Per-customer critical sections, shared by redeem and cancel. */
  locks: OwnerLocks;
  now: () => Date;
};

const isLine = (l: unknown): l is Line => {
  const x = l as Line;
  return typeof x?.sku === "string" && Number.isInteger(x.unitPriceCents) && x.unitPriceCents >= 0
    && Number.isInteger(x.quantity) && x.quantity > 0;
};

/** Customer-facing order API. */
export function orderRoutes(router: Router, deps: OrderRouteDeps): Router {
  // Pre-wire the use-case collaborators once; routes receive them, never build them.
  const releaseRedemptions = (orderId: string) =>
    releaseOrderRedemptions({ loyalty: deps.loyalty, redemptions: deps.redemptions, now: deps.now }, orderId);
  const cancelDeps = { orders: deps.orders, locks: deps.locks, releaseRedemptions };
  const redeemDeps = { orders: deps.orders, loyalty: deps.loyalty, redemptions: deps.redemptions, locks: deps.locks, now: deps.now };

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
    cancelOrder(cancelDeps, { orderId: params.id!, customerId: customer.id })));

  const isPositiveInt = (v: unknown): v is number => Number.isInteger(v) && v > 0;

  router.add("POST", "/orders/:id/redeem", withCustomer(deps.sessions, (req, params, customer) => {
    const body = req.body as { points?: unknown; idempotencyKey?: unknown } | undefined;
    if (!body || !isPositiveInt(body.points)) return { status: 400, body: { error: "points must be a positive integer" } };
    if (typeof body.idempotencyKey !== "string" || body.idempotencyKey.length === 0)
      return { status: 400, body: { error: "idempotencyKey must be a non-empty string" } };
    return redeemPoints(redeemDeps, { orderId: params.id!, customerId: customer.id,
      points: body.points, idempotencyKey: body.idempotencyKey });
  }));

  return router;
}
