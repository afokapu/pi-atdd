import type { Router } from "../../http/router.ts";
import { withCustomer, type SessionStore } from "../../http/auth.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { cancel, OrderStateError, type PointsRedemption } from "../domain/order.ts";
import { quoteForOrder, quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import { isExpired } from "../../loyalty/domain/points.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { Line } from "../../pricing/domain/quote.ts";

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

    return deps.loyalty.forCustomer(customer.id, async () => {
      const order = deps.orders.get(params.id!);
      if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
      const previous = order.redemptions?.find(r => r.idempotencyKey === body.idempotencyKey);
      if (previous) {
        if (previous.requestedPoints !== body.points)
          return { status: 409, body: { error: "idempotency key was used with a different body" } };
        return { status: 200, body: quoteForOrderWithPoints(order, previous.quotePointsAppliedCents) };
      }
      if (order.status !== "pending") return { status: 409, body: { error: "order " + order.id + " is " + order.status } };

      const before = (order.redemptions ?? []).reduce((sum, r) => sum + r.pointsAppliedCents, 0);
      const base = quoteForOrder(order); // also validates the order's tax region and discount
      const maximum = Math.max(0, base.subtotalCents - base.discountCents - before);
      const toSpend = Math.min(body.points, maximum);
      let remaining = toSpend;
      const at = deps.now();
      const lots = (await deps.loyalty.lotsFor(customer.id))
        .filter(lot => !isExpired(lot, at) && lot.points > 0)
        .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
      const used: PointsRedemption["lots"] = [];
      for (const lot of lots) {
        if (remaining === 0) break;
        const points = Math.min(remaining, lot.points);
        await deps.loyalty.saveLot({ ...lot, points: lot.points - points });
        used.push({ lotId: lot.id, points, expiresAt: lot.expiresAt });
        remaining -= points;
      }
      const applied = toSpend - remaining;
      const redemption: PointsRedemption = {
        idempotencyKey: body.idempotencyKey,
        requestedPoints: body.points,
        pointsAppliedCents: applied,
        quotePointsAppliedCents: before + applied,
        lots: used,
      };
      deps.orders.save({ ...order, redemptions: [...(order.redemptions ?? []), redemption] });
      return { status: 200, body: quoteForOrderWithPoints(order, before + applied) };
    });
  }));

  router.add("POST", "/orders/:id/cancel", withCustomer(deps.sessions, async (_req, params, customer) => {
    return deps.loyalty.forCustomer(customer.id, async () => {
      const order = deps.orders.get(params.id!);
      if (!order || order.customerId !== customer.id) return { status: 404, body: { error: "order not found" } };
      try {
        const cancelled = cancel(order);
        const at = deps.now();
        for (const redemption of order.redemptions ?? []) for (const debit of redemption.lots) {
          // Expired points are deliberately not resurrected on cancellation.
          if (debit.points === 0 || isExpired({ id: debit.lotId, customerId: customer.id, points: 0, expiresAt: debit.expiresAt }, at)) continue;
          const current = await deps.loyalty.getLot(debit.lotId);
          await deps.loyalty.saveLot({
            id: debit.lotId,
            customerId: customer.id,
            points: (current?.points ?? 0) + debit.points,
            expiresAt: debit.expiresAt,
          });
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
