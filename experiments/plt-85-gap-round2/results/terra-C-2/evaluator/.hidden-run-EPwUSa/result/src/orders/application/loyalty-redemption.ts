import { cancel, OrderStateError, type Order, type Redemption } from "../domain/order.ts";
import type { PointsLot } from "../../loyalty/domain/points.ts";
import { quoteWithPointsForOrder } from "../../pricing/application/quote-service.ts";
import type { PointsQuote } from "../../pricing/domain/quote.ts";

/**
 * Loyalty payment coordinates order state and the ledger without depending on an adapter.
 * The order record holds the original result because a retry must not use current pricing.
 */
/** Ports keep the use case independent from the in-memory persistence adapter. */
type OrderStore = { get(id: string): Order | undefined; save(order: Order): void };
type LoyaltyLedger = {
  withCustomerLock<T>(customerId: string, operation: () => Promise<T>): Promise<T>;
  validLotsFor(customerId: string, at: Date): Promise<PointsLot[]>;
  lotsByIds(ids: readonly string[]): Promise<PointsLot[]>;
  saveLots(lots: readonly PointsLot[]): Promise<void>;
};
export type LoyaltyRedemptionDeps = { orders: OrderStore; loyalty: LoyaltyLedger; now: () => Date };

export class IdempotencyConflictError extends Error {}

/**
 * The per-customer ledger lock covers the order idempotency record and lot debit.
 * Pricing is reductions before tax; each point is already one integer cent.
 */
export async function redeemOrder(
  deps: LoyaltyRedemptionDeps, customerId: string, orderId: string, points: number, idempotencyKey: string,
): Promise<PointsQuote> {
  return deps.loyalty.withCustomerLock(customerId, async () => {
    const order = ownedOrder(deps.orders, orderId, customerId);
    const replay = replayQuote(order, points, idempotencyKey);
    if (replay) return replay;
    if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);

    // Price first: only the discounted, pre-tax amount can be paid with points.
    const requestedQuote = quoteWithPointsForOrder(order, points);
    // This indexed query also excludes expired and empty historical lots.
    const lots = await deps.loyalty.validLotsFor(customerId, deps.now());
    const applied = Math.min(requestedQuote.pointsAppliedCents, availablePoints(lots));
    const quote = quoteWithPointsForOrder(order, applied);
    const { allocations, changedLots } = allocate(lots, applied);
    // The debit and immutable replay record are protected by the same owner lock.
    await deps.loyalty.saveLots(changedLots);
    deps.orders.save({ ...order, status: "redeemed", redemption: record(idempotencyKey, points, allocations, quote) });
    return quote;
  });
}

/** Restore allocations to their original lots, but only if they remain valid now. */
export async function cancelOrder(
  deps: LoyaltyRedemptionDeps, customerId: string, orderId: string,
): Promise<Order> {
  return deps.loyalty.withCustomerLock(customerId, async () => {
    const order = ownedOrder(deps.orders, orderId, customerId);
    const cancelled = cancel(order);
    if (order.redemption) await restoreLots(deps, customerId, order.redemption);
    deps.orders.save(cancelled);
    return cancelled;
  });
}

function ownedOrder(store: OrderStore, orderId: string, customerId: string): Order {
  const order = store.get(orderId);
  if (!order || order.customerId !== customerId) throw new OrderNotFoundError();
  return order;
}

function replayQuote(order: Order, points: number, key: string): PointsQuote | undefined {
  if (!order.redemption || order.redemption.idempotencyKey !== key) return undefined;
  if (order.redemption.requestedPoints !== points) throw new IdempotencyConflictError("idempotency key payload differs");
  return { ...order.redemption.quote };
}

function availablePoints(lots: readonly PointsLot[]): number {
  return lots.reduce((total, lot) => total + lot.points, 0);
}

function allocate(lots: readonly PointsLot[], requested: number): {
  allocations: { lotId: string; points: number }[]; changedLots: PointsLot[];
} {
  let remaining = requested;
  const allocations: { lotId: string; points: number }[] = [];
  const changedLots: PointsLot[] = [];
  for (const lot of lots) {
    const points = Math.min(lot.points, remaining);
    if (points > 0) {
      allocations.push({ lotId: lot.id, points });
      changedLots.push({ ...lot, points: lot.points - points });
      remaining -= points;
    }
  }
  return { allocations, changedLots };
}

async function restoreLots(deps: LoyaltyRedemptionDeps, customerId: string, redemption: Redemption): Promise<void> {
  // Original ids, rather than a new FIFO pass, retain each lot's expiry identity.
  const lots = await deps.loyalty.lotsByIds(redemption.allocations.map(allocation => allocation.lotId));
  const allocations = new Map(redemption.allocations.map(allocation => [allocation.lotId, allocation.points]));
  // Cancellation-time expiry decides whether an allocation is restored or forfeited.
  const now = deps.now();
  const changedLots = lots.flatMap(lot => {
    const points = allocations.get(lot.id);
    return lot.customerId === customerId && points && lot.expiresAt.getTime() > now.getTime()
      ? [{ ...lot, points: lot.points + points }]
      : [];
  });
  await deps.loyalty.saveLots(changedLots);
}

function record(key: string, points: number, allocations: { lotId: string; points: number }[], quote: PointsQuote): Redemption {
  return { idempotencyKey: key, requestedPoints: points, allocations, quote };
}

export class OrderNotFoundError extends Error {}
