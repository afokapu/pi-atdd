import { addRedemption, cancel, pointsRedeemed, type Order } from "../domain/order.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { LoyaltyLedger } from "../../loyalty/application/ledger-service.ts";
import type { InMemoryIdempotencyStore } from "../../loyalty/integration/idempotency-store.ts";
import { centsToPoints, pointsToCents } from "../../loyalty/domain/points.ts";
import { quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import { discountCents } from "../../pricing/domain/discount.ts";
import { subtotal, type QuoteWithPoints } from "../../pricing/domain/quote.ts";

export class OrderNotFoundError extends Error {}
export class IdempotencyConflictError extends Error {}

export type OrderPaymentDeps = {
  orders: InMemoryOrderStore;
  ledger: LoyaltyLedger;
  idempotency: InMemoryIdempotencyStore;
};

/** Quote of an order including the points already redeemed on it. */
export function orderQuoteWithPoints(order: Order): QuoteWithPoints {
  const points = pointsRedeemed(order);
  return quoteForOrderWithPoints(order, points, pointsToCents(points));
}

const scope = (customerId: string) => "redeem:" + customerId;

/**
 * Use case: the owner of a pending order pays part of it with points.
 * Points are capped at the amount still payable after discount (excess is not consumed).
 * Idempotent per (customer, key); a reused key with a different body is rejected.
 */
export async function redeemPoints(deps: OrderPaymentDeps,
  cmd: { customerId: string; orderId: string; points: number; idempotencyKey: string }): Promise<QuoteWithPoints> {
  const fingerprint = JSON.stringify([cmd.orderId, cmd.points]);
  return deps.ledger.withCustomerLock(cmd.customerId, async () => {
    const prior = await deps.idempotency.get(scope(cmd.customerId), cmd.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new IdempotencyConflictError("idempotency key reused with a different request");
      return prior.response as QuoteWithPoints;
    }

    const order = deps.orders.get(cmd.orderId);
    if (!order || order.customerId !== cmd.customerId) throw new OrderNotFoundError("order not found");
    // Validates state before any points are touched.
    addRedemption(order, { idempotencyKey: cmd.idempotencyKey, points: 0, allocations: [] });

    const sub = subtotal(order.lines);
    const payableCents = sub - discountCents(sub, order.discountCode) - pointsToCents(pointsRedeemed(order));
    const toConsume = Math.min(cmd.points, centsToPoints(Math.max(0, payableCents)));

    const allocations = await deps.ledger.consume(cmd.customerId, toConsume);
    let updated = order;
    try {
      if (toConsume > 0) {
        updated = addRedemption(order, { idempotencyKey: cmd.idempotencyKey, points: toConsume, allocations });
        deps.orders.save(updated);
      }
    } catch (e) {
      await deps.ledger.restore(allocations, { ignoreExpiry: true });
      throw e;
    }

    const response = orderQuoteWithPoints(updated);
    await deps.idempotency.put(scope(cmd.customerId), cmd.idempotencyKey, { fingerprint, response });
    return response;
  });
}

/**
 * Use case: the owner cancels a pending order. Redeemed points go back to their
 * original lots (original expiry); points whose lot has expired by now are forfeited.
 */
export async function cancelOrder(deps: OrderPaymentDeps, cmd: { customerId: string; orderId: string }): Promise<Order> {
  return deps.ledger.withCustomerLock(cmd.customerId, async () => {
    const order = deps.orders.get(cmd.orderId);
    if (!order || order.customerId !== cmd.customerId) throw new OrderNotFoundError("order not found");
    const cancelled = cancel(order);
    deps.orders.save(cancelled);
    for (const r of order.redemptions ?? []) await deps.ledger.restore(r.allocations);
    return cancelled;
  });
}
