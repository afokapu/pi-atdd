import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import { allocatePoints, balanceOf, usableLots, InsufficientPointsError } from "../../loyalty/domain/points.ts";
import { quoteOrderWithPoints } from "../../pricing/application/quote-service.ts";
import type { PointsQuote } from "../../pricing/domain/quote.ts";
import { OrderStateError, type Order } from "../domain/order.ts";

export class IdempotencyKeyReusedError extends Error {}
export class OrderAlreadyRedeemedError extends Error {}

export type RedeemDeps = { loyalty: InMemoryLoyaltyStore; now: () => Date };

/**
 * Use case: pay part of a pending order with loyalty points.
 *
 * A replay with the same key and body returns the stored quote and consumes nothing.
 * The requested amount must be covered by usable lots; points beyond the amount due
 * are not consumed. The caller must hold the customer lock.
 */
export async function redeemPoints(
  deps: RedeemDeps,
  order: Order,
  input: { points: number; idempotencyKey: string },
): Promise<PointsQuote> {
  const fingerprint = order.id + ":" + input.points;
  const previous = await deps.loyalty.redemptionByKey<PointsQuote>(order.customerId, input.idempotencyKey);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new IdempotencyKeyReusedError("idempotency key already used for a different request");
    return previous.result;
  }
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  if (await deps.loyalty.redemptionForOrder(order.id)) throw new OrderAlreadyRedeemedError("order " + order.id + " already has points redeemed");

  const usable = usableLots(await deps.loyalty.lotsFor(order.customerId), deps.now());
  if (input.points > balanceOf(usable)) throw new InsufficientPointsError("insufficient points");

  const result = quoteOrderWithPoints(order, input.points);
  const debits = allocatePoints(usable, result.pointsAppliedCents);
  for (const debit of debits) {
    await deps.loyalty.saveLot({ ...debit.lot, points: debit.lot.points - debit.points });
  }
  await deps.loyalty.saveRedemption({
    orderId: order.id,
    customerId: order.customerId,
    idempotencyKey: input.idempotencyKey,
    fingerprint,
    allocations: debits.map(d => ({ lotId: d.lot.id, points: d.points, expiresAt: d.lot.expiresAt })),
    status: "held",
    result,
  });
  return result;
}
