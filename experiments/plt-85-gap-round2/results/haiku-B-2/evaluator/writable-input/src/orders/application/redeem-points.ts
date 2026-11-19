import type { PricedQuote } from "../../pricing/domain/quote.ts";
import { subtotal } from "../../pricing/domain/quote.ts";
import { discountedSubtotal } from "../../pricing/domain/discount.ts";
import { quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import { allocatePoints } from "../../loyalty/domain/points.ts";
import { withCustomerLock, adjustLot } from "../../loyalty/application/ledger.ts";
import { OrderStateError, type Redemption } from "../domain/order.ts";
import { loadOwnedOrder, type OrderUseCaseDeps } from "./owned-order.ts";

/** The same idempotency key was sent again with a different body. */
export class IdempotencyKeyReusedError extends Error {}
/** The order already carries a redemption under another key. */
export class OrderAlreadyRedeemedError extends Error {}

export type RedeemInput = { orderId: string; customerId: string; points: number; idempotencyKey: string };

/**
 * Use case: pay part of a pending order with loyalty points.
 * Runs under the customer's lock so two redemptions never spend the same lot.
 * Idempotency is scoped to the order: a repeat with the same key returns the stored quote and spends nothing.
 */
export function redeemPoints(deps: OrderUseCaseDeps, input: RedeemInput): Promise<PricedQuote> {
  return withCustomerLock(input.customerId, () => redeemUnderLock(deps, input));
}

async function redeemUnderLock(deps: OrderUseCaseDeps, input: RedeemInput): Promise<PricedQuote> {
  const order = loadOwnedOrder(deps.orders, input.orderId, input.customerId);
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  if (order.redemption) return replayOrReject(order.redemption, input);

  const lots = await deps.loyalty.lotsFor(input.customerId);
  // Points reduce the discounted amount only; they never take it below zero. 1 point = 1 cent (100 points = EUR 1).
  const cap = Math.min(input.points, discountedSubtotal(subtotal(order.lines), order.discountCode));
  const allocations = allocatePoints(lots, cap, deps.now());
  const applied = allocations.reduce((sum, a) => sum + a.points, 0);
  const priced = quoteForOrderWithPoints(order, applied);

  for (const a of allocations) await adjustLot(deps.loyalty, input.customerId, a, -a.points);
  const redemption: Redemption = { idempotencyKey: input.idempotencyKey, requestedPoints: input.points, allocations, quote: priced };
  deps.orders.save({ ...order, redemption });
  return priced;
}

/** A redemption already exists: an identical retry gets the stored quote, anything else is rejected. */
function replayOrReject(prior: Redemption, input: RedeemInput): PricedQuote {
  if (prior.idempotencyKey !== input.idempotencyKey) throw new OrderAlreadyRedeemedError("order already has points applied");
  if (prior.requestedPoints !== input.points) throw new IdempotencyKeyReusedError("idempotency key reused with a different request");
  return prior.quote;
}
