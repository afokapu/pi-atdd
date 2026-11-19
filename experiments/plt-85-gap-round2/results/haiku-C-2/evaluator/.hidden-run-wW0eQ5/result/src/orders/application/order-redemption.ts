/**
 * Use cases that pay for or unwind a points redemption on an order. Both run under the
 * customer's lock: the order status, the redemption record and the lot balances are read
 * and written as one unit, so a redeem and a cancel of the same order cannot interleave.
 */
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import type { CustomerLock } from "../../loyalty/application/customer-lock.ts";
import {
  allocatePoints, availablePoints, centsForPoints, InsufficientPointsError, pointsForCents,
  restoreAllocations, type Allocation, type PointsLot,
} from "../../loyalty/domain/points.ts";
import type { Redemption, RedemptionQuote } from "../../loyalty/domain/redemption.ts";
import { cancel, OrderStateError, type Order } from "../domain/order.ts";
import { quoteOrderWithPoints } from "../../pricing/application/quote-service.ts";

export type RedemptionDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  locks: CustomerLock;
  now: () => Date;
};

export class OrderNotFoundError extends Error {}

/** The order already has a different redemption, or the key was reused with another request. */
export class RedemptionConflictError extends Error {}

export type RedeemCommand = { orderId: string; customerId: string; points: number; idempotencyKey: string };
export type RedeemResult = { replayed: boolean; quote: RedemptionQuote };

function ownedOrder(orders: InMemoryOrderStore, orderId: string, customerId: string): Order {
  const order = orders.get(orderId);
  if (!order || order.customerId !== customerId) throw new OrderNotFoundError("order not found");
  return order;
}

/**
 * Pay part of a pending order with points. A repeated request with the same key and points
 * returns the original quote and consumes nothing; a different request is rejected.
 */
export function redeemPoints(deps: RedemptionDeps, cmd: RedeemCommand): Promise<RedeemResult> {
  return deps.locks.run(cmd.customerId, async () => {
    const order = ownedOrder(deps.orders, cmd.orderId, cmd.customerId);
    const existing = await deps.loyalty.getRedemption(order.id);
    if (existing) return replayOrReject(existing, cmd);
    if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
    return applyRedemption(deps, order, cmd);
  });
}

function replayOrReject(existing: Redemption, cmd: RedeemCommand): RedeemResult {
  if (existing.idempotencyKey !== cmd.idempotencyKey) throw new RedemptionConflictError("order already has a redemption");
  if (existing.points !== cmd.points) throw new RedemptionConflictError("idempotency key reused with a different request");
  return { replayed: true, quote: existing.quote };
}

async function applyRedemption(deps: RedemptionDeps, order: Order, cmd: RedeemCommand): Promise<RedeemResult> {
  const at = deps.now();
  const lots = await deps.loyalty.lotsFor(cmd.customerId);
  if (cmd.points > availablePoints(lots, at)) throw new InsufficientPointsError("not enough usable points");
  const quote = quoteOrderWithPoints(order, centsForPoints(cmd.points));
  const allocations = allocatePoints(lots, pointsForCents(quote.pointsAppliedCents), at);
  await debit(deps.loyalty, lots, allocations);
  await deps.loyalty.saveRedemption({
    orderId: order.id, customerId: cmd.customerId, idempotencyKey: cmd.idempotencyKey,
    points: cmd.points, allocations, quote, status: "applied",
  });
  return { replayed: false, quote };
}

async function debit(loyalty: InMemoryLoyaltyStore, lots: PointsLot[], allocations: Allocation[]): Promise<void> {
  const byId = new Map(lots.map(l => [l.id, l]));
  for (const a of allocations) {
    const lot = byId.get(a.lotId)!;
    await loyalty.saveLot({ ...lot, points: lot.points - a.points });
  }
}

/**
 * Cancel a pending order. If it was redeemed, the recorded allocations go back to their
 * original lots; points whose lot has expired by now are forfeited. The status change is
 * made only after the restore succeeds, and the redemption is marked reversed so the
 * restore happens once.
 */
export function cancelOrder(deps: RedemptionDeps, orderId: string, customerId: string): Promise<Order> {
  return deps.locks.run(customerId, async () => {
    const cancelled = cancel(ownedOrder(deps.orders, orderId, customerId));
    const redemption = await deps.loyalty.getRedemption(orderId);
    if (redemption?.status === "applied") await reverse(deps, redemption);
    deps.orders.save(cancelled);
    return cancelled;
  });
}

async function reverse(deps: RedemptionDeps, redemption: Redemption): Promise<void> {
  const lots = await deps.loyalty.lotsFor(redemption.customerId);
  const restoration = restoreAllocations(lots, redemption.allocations, deps.now());
  for (const lot of restoration.changed) await deps.loyalty.saveLot(lot);
  await deps.loyalty.saveRedemption({ ...redemption, status: "reversed" });
}
