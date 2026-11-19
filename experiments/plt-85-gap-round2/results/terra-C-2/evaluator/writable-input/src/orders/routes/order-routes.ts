import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import { OrderStateError, type Order } from "../domain/order.ts";
import type { PointsLot } from "../../loyalty/domain/points.ts";
import { cancelOrder, IdempotencyConflictError, OrderNotFoundError, redeemOrder } from "../application/loyalty-redemption.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";

// Routes consume ports; src/app.ts supplies their concrete adapters.
type OrderStore = { get(id: string): Order | undefined; save(order: Order): void; all(): Order[] };
type LoyaltyStore = {
  withCustomerLock<T>(customerId: string, operation: () => Promise<T>): Promise<T>;
  validLotsFor(customerId: string, at: Date): Promise<PointsLot[]>;
  lotsByIds(ids: readonly string[]): Promise<PointsLot[]>;
  saveLots(lots: readonly PointsLot[]): Promise<void>;
};
export type OrderRouteDeps = { orders: OrderStore; loyalty: LoyaltyStore; sessions: SessionStore; now: () => Date };

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
    const body = req.body as { points?: unknown; idempotencyKey?: unknown } | undefined;
    if (!Number.isInteger(body?.points) || (body.points as number) <= 0)
      return { status: 400, body: { error: "points must be a positive integer" } };
    if (typeof body?.idempotencyKey !== "string" || body.idempotencyKey.length === 0)
      return { status: 400, body: { error: "idempotencyKey required" } };
    try {
      const quote = await redeemOrder(deps, customer.id, params.id!, body.points, body.idempotencyKey);
      return { status: 200, body: quote };
    } catch (error) {
      return redemptionError(error);
    }
  }));

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, async (_req, params, customer) => {
    try {
      return { status: 200, body: await cancelOrder(deps, customer.id, params.id!) };
    } catch (error) {
      if (error instanceof OrderNotFoundError) return { status: 404, body: { error: "order not found" } };
      if (error instanceof OrderStateError) return { status: 409, body: { error: error.message } };
      throw error;
    }
  }));

  return router;
}

/** Route errors are deliberately mapped after the use case has released its ledger lock. */
function redemptionError(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof OrderNotFoundError) return { status: 404, body: { error: "order not found" } };
  if (error instanceof IdempotencyConflictError) return { status: 409, body: { error: error.message } };
  if (error instanceof OrderStateError) return { status: 409, body: { error: error.message } };
  throw error;
}
