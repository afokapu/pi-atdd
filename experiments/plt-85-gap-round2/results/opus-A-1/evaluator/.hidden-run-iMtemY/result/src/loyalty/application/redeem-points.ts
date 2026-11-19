import type { InMemoryOrderStore } from "../../orders/integration/order-store.ts";
import { assertRedeemable, redeem } from "../../orders/domain/order.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import type { Quote } from "../../pricing/domain/quote.ts";
import type { InMemoryLoyaltyStore } from "../integration/loyalty-store.ts";
import { allocate, CENTS_PER_POINT, pointsToApply } from "../domain/points.ts";
import type { CustomerLock } from "./customer-lock.ts";
import { debit } from "./ledger.ts";

export class OrderNotFoundError extends Error {}
export class IdempotencyConflictError extends Error {}

type Recorded = { orderId: string; points: number; result: Quote };

/** Remembers successful redemptions per (customer, idempotency key). In memory. */
export class IdempotencyStore {
  private entries = new Map<string, Recorded>();
  get(customerId: string, key: string) { return this.entries.get(customerId + "\u0000" + key); }
  set(customerId: string, key: string, r: Recorded) { this.entries.set(customerId + "\u0000" + key, r); }
}

export type RedeemDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  lock: CustomerLock;
  idempotency: IdempotencyStore;
  now: () => Date;
};

/**
 * Use case LOY-002: pay part of a pending order with points. Points reduce the
 * discounted amount before tax, never below zero; points beyond that are not consumed.
 * Runs under the customer's lock so concurrent requests cannot spend the same points.
 */
export function redeemPoints(deps: RedeemDeps, customerId: string, orderId: string, points: number, key: string): Promise<Quote> {
  return deps.lock.run(customerId, async () => {
    const seen = deps.idempotency.get(customerId, key);
    if (seen) {
      if (seen.orderId !== orderId || seen.points !== points)
        throw new IdempotencyConflictError("idempotency key already used with a different request");
      return structuredClone(seen.result);
    }
    const order = deps.orders.get(orderId);
    if (!order || order.customerId !== customerId) throw new OrderNotFoundError("order not found");
    assertRedeemable(order);

    const before = quoteForOrder(order);
    const applied = pointsToApply(points, before.subtotalCents - before.discountCents);
    const at = deps.now();
    const lots = await deps.loyalty.lotsFor(customerId);
    const allocations = allocate(lots, applied, at);
    await debit(deps.loyalty, lots, allocations);

    const updated = redeem(order, { idempotencyKey: key, points: applied, pointsCents: applied * CENTS_PER_POINT, allocations });
    deps.orders.save(updated);
    const result = quoteForOrder(updated);
    deps.idempotency.set(customerId, key, { orderId, points, result: structuredClone(result) });
    return result;
  });
}
