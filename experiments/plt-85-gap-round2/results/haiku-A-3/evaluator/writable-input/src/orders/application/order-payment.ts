import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import {
  allocatePoints, centsToPoints, isExpired, pointsToCents, spendablePoints, InsufficientPointsError,
} from "../../loyalty/domain/points.ts";
import type { Redemption, RedemptionQuote } from "../../loyalty/domain/redemption.ts";
import { withCustomerLock } from "../../loyalty/application/customer-lock.ts";
import { quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import { OrderStateError } from "../domain/order.ts";

export class OrderNotFoundError extends Error {}
export class IdempotencyConflictError extends Error {}
export class AlreadyRedeemedError extends Error {}

export type PaymentDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  now: () => Date;
};

export type RedeemInput = { points: number; idempotencyKey: string };

/**
 * Use case LOY-002: pay part of a pending order with points.
 * Runs under the customer's lock, so concurrent redemptions cannot spend the same lots.
 * Repeating a key returns the stored result without spending anything again.
 */
export function redeemOrderPoints(deps: PaymentDeps, customerId: string, orderId: string,
  input: RedeemInput): Promise<RedemptionQuote> {
  return withCustomerLock(customerId, async () => {
    const fingerprint = JSON.stringify([orderId, input.points]);
    const prior = await deps.loyalty.redemptionByKey(customerId, input.idempotencyKey);
    if (prior) {
      if (prior.requestFingerprint !== fingerprint)
        throw new IdempotencyConflictError("idempotency key already used for a different request");
      return prior.quote;
    }

    const order = deps.orders.get(orderId);
    if (!order || order.customerId !== customerId) throw new OrderNotFoundError("order not found");
    if (order.status !== "pending") throw new OrderStateError("order " + orderId + " is " + order.status);
    if (await deps.loyalty.redemptionForOrder(orderId))
      throw new AlreadyRedeemedError("order " + orderId + " already paid with points");

    const now = deps.now();
    const lots = await deps.loyalty.lotsFor(customerId);
    if (input.points > spendablePoints(lots, now)) throw new InsufficientPointsError("not enough spendable points");

    const quote = quoteForOrderWithPoints(order, pointsToCents(input.points));
    const appliedPoints = centsToPoints(quote.pointsAppliedCents);
    const allocations = allocatePoints(lots, appliedPoints, now);
    for (const a of allocations) {
      const lot = lots.find(l => l.id === a.lotId)!;
      await deps.loyalty.saveLot({ ...lot, points: lot.points - a.points });
    }
    const result: RedemptionQuote = {
      region: quote.region, subtotalCents: quote.subtotalCents, discountCents: quote.discountCents,
      pointsAppliedCents: quote.pointsAppliedCents, taxCents: quote.taxCents, totalCents: quote.totalCents,
    };
    const record: Redemption = {
      customerId, idempotencyKey: input.idempotencyKey, orderId, requestFingerprint: fingerprint,
      allocations, quote: result,
    };
    await deps.loyalty.saveRedemption(record);
    return result;
  });
}

/**
 * Give back the points spent on an order. Each point returns to its original lot with the
 * original expiry; points whose lot has expired by `now` are forfeited.
 * Callers must hold the customer's lock.
 */
export async function reverseOrderRedemption(loyalty: InMemoryLoyaltyStore, orderId: string, now: Date): Promise<void> {
  const record = await loyalty.redemptionForOrder(orderId);
  if (!record) return;
  for (const a of record.allocations) {
    const lot = await loyalty.getLot(a.lotId);
    if (!lot || isExpired(lot, now)) continue;
    await loyalty.saveLot({ ...lot, points: lot.points + a.points });
  }
}
