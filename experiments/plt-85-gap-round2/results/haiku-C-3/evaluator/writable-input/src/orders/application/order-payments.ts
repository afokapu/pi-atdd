/**
 * Use cases that move money or points for an order: paying part of it with loyalty points and
 * cancelling it (which gives redeemed points back). Both run inside the customer's critical
 * section so that they cannot interleave with each other or with another redemption.
 *
 * The loyalty ledger is asynchronous, so every check that precedes a write is repeated inside
 * the critical section; checks made before acquiring the lock would be stale by the time they run.
 */
import { assertPending, cancel, type Order } from "../domain/order.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryLoyaltyStore, Redemption } from "../../loyalty/integration/loyalty-store.ts";
import { allocatePoints, pointsValueCents, splitRestorable, type Allocation } from "../../loyalty/domain/points.ts";
import type { KeyedLock } from "../../common/keyed-lock.ts";
import { quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import type { PointsQuote } from "../../pricing/domain/quote.ts";

export type PaymentDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  locks: KeyedLock;
  now: () => Date;
};

export class OrderNotFoundError extends Error {}
export class InsufficientPointsError extends Error {}
export class AlreadyRedeemedError extends Error {}
/** The same idempotency key was sent with a different order or number of points. */
export class IdempotencyConflictError extends Error {}

export type RedeemCommand = { customerId: string; orderId: string; points: number; idempotencyKey: string };

/**
 * Pay part of a pending order with points. Returns the quote the customer sees.
 * Same key and same request: the stored quote is returned and nothing is consumed again.
 */
export function redeemPoints(deps: PaymentDeps, cmd: RedeemCommand): Promise<PointsQuote> {
  return deps.locks.run(cmd.customerId, () => redeemLocked(deps, cmd));
}

/** Cancel a pending order. If it was paid with points, the points go back to their lots. */
export function cancelOrder(deps: PaymentDeps, customerId: string, orderId: string): Promise<Order> {
  return deps.locks.run(customerId, async () => {
    const cancelled = cancel(ownedOrder(deps, customerId, orderId));
    await reverseRedemption(deps, customerId, orderId);
    deps.orders.save(cancelled);
    return cancelled;
  });
}

async function redeemLocked(deps: PaymentDeps, cmd: RedeemCommand): Promise<PointsQuote> {
  const order = ownedOrder(deps, cmd.customerId, cmd.orderId);
  const previous = await deps.loyalty.redemptionByKey(cmd.customerId, cmd.idempotencyKey);
  if (previous) return replayOf(previous, cmd);
  assertPending(order);
  if (await deps.loyalty.redemptionForOrder(order.id)) throw new AlreadyRedeemedError("order " + order.id + " already paid with points");
  return debit(deps, order, cmd);
}

function ownedOrder(deps: PaymentDeps, customerId: string, orderId: string): Order {
  const order = deps.orders.get(orderId);
  if (!order || order.customerId !== customerId) throw new OrderNotFoundError("order not found");
  return order;
}

/** A replay must match the original request exactly; anything else would silently change its meaning. */
function replayOf(previous: Redemption, cmd: RedeemCommand): PointsQuote {
  if (previous.orderId !== cmd.orderId || previous.requestedPoints !== cmd.points)
    throw new IdempotencyConflictError("idempotency key already used with a different request");
  return previous.quote;
}

/**
 * Price the order with the points applied, then consume exactly the points applied (never the
 * excess requested) from usable lots, earliest expiry first.
 */
async function debit(deps: PaymentDeps, order: Order, cmd: RedeemCommand): Promise<PointsQuote> {
  const quote = quoteForOrderWithPoints(order, pointsValueCents(cmd.points));
  const lots = await deps.loyalty.lotsFor(cmd.customerId);
  const { allocations, shortfall } = allocatePoints(lots, quote.pointsCents, deps.now());
  if (shortfall > 0) throw new InsufficientPointsError("not enough usable points");
  const byId = new Map(lots.map(l => [l.id, l]));
  for (const a of allocations) {
    const lot = byId.get(a.lotId)!;
    await deps.loyalty.saveLot({ ...lot, points: lot.points - a.points });
  }
  await deps.loyalty.saveRedemption({
    customerId: cmd.customerId, orderId: order.id, idempotencyKey: cmd.idempotencyKey,
    requestedPoints: cmd.points, allocations, reversed: false, quote,
  });
  return quote;
}

/**
 * Give a redeemed order's points back to their original lots, with the original expiry. Points
 * whose lot has expired by now are forfeited. Marked reversed after restoring, so it happens once.
 */
async function reverseRedemption(deps: PaymentDeps, customerId: string, orderId: string): Promise<void> {
  const redemption = await deps.loyalty.redemptionForOrder(orderId);
  if (!redemption || redemption.reversed) return;
  const { restorable } = splitRestorable(redemption.allocations, deps.now());
  for (const a of restorable) await restore(deps, customerId, a);
  await deps.loyalty.saveRedemption({ ...redemption, reversed: true });
}

async function restore(deps: PaymentDeps, customerId: string, a: Allocation): Promise<void> {
  const lot = (await deps.loyalty.getLot(a.lotId)) ?? { id: a.lotId, customerId, points: 0, expiresAt: a.expiresAt };
  await deps.loyalty.saveLot({ ...lot, points: lot.points + a.points });
}
