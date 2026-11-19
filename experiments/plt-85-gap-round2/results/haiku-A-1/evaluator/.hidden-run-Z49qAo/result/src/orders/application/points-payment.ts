import { randomUUID } from "node:crypto";
import { OrderStateError, type Order } from "../domain/order.ts";
import { subtotal, quoteWithPoints } from "../../pricing/domain/quote.ts";
import { discountedSubtotal } from "../../pricing/domain/discount.ts";
import { getTaxRate } from "../../pricing/integration/tax-rates.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import {
  allocatePoints, pointsToApply, pointsValueCents, restore, spend, usablePoints,
} from "../../loyalty/domain/points.ts";
import { PointsConflictError, type PointsQuote, type Redemption } from "../../loyalty/domain/redemption.ts";

/**
 * Use case: pay part of a pending order with points. Must run under the customer's lock.
 * Same idempotency key + same order and points → the stored result, nothing consumed.
 */
export async function redeemOrder(
  loyalty: InMemoryLoyaltyStore, order: Order, points: number, idempotencyKey: string, at: Date,
): Promise<PointsQuote> {
  const prior = await loyalty.redemptionByKey(order.customerId, idempotencyKey);
  if (prior) {
    if (prior.orderId === order.id && prior.requestedPoints === points) return prior.result;
    throw new PointsConflictError("idempotency key was already used for a different request");
  }
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  if (await loyalty.redemptionForOrder(order.id))
    throw new PointsConflictError("order " + order.id + " already has a points redemption");

  const lots = await loyalty.lotsFor(order.customerId);
  const payableCents = discountedSubtotal(subtotal(order.lines), order.discountCode);
  const applied = pointsToApply(points, usablePoints(lots, at), payableCents);
  if (applied === 0) throw new PointsConflictError("no usable points can be applied to order " + order.id);

  const result = quoteWithPoints(order.lines, order.region, getTaxRate(order.region), order.discountCode,
    pointsValueCents(applied));
  const allocations = allocatePoints(lots, applied, at);
  const redemption: Redemption = {
    id: randomUUID(), customerId: order.customerId, orderId: order.id, idempotencyKey,
    requestedPoints: points, pointsApplied: applied, allocations, result,
  };
  await loyalty.commit({ lots: spend(lots, allocations), redemption });
  return result;
}

/**
 * Use case: undo a redemption when its order is cancelled. Points return to their original
 * lots; points whose lot has expired by `at` are forfeited. Must run under the customer's lock.
 */
export async function releaseRedemption(loyalty: InMemoryLoyaltyStore, orderId: string, at: Date): Promise<void> {
  const redemption = await loyalty.redemptionForOrder(orderId);
  if (!redemption || redemption.reversedAt) return;
  const lots = await loyalty.lotsFor(redemption.customerId);
  await loyalty.commit({
    lots: restore(lots, redemption.allocations, at),
    redemption: { ...redemption, reversedAt: at },
  });
}
