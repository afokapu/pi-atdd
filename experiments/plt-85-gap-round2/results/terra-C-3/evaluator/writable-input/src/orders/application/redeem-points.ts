import { isExpired, type PointsLot } from "../../loyalty/domain/points.ts";
import { quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import { cancel, OrderStateError, type Order, type PointsAllocation, type PointsRedemption } from "../domain/order.ts";
import type { PointsQuote } from "../../pricing/domain/quote.ts";

/** Ports keep the use case independent of the in-memory adapter used by the app. */
type OrderStore = { get(id: string): Order | undefined; save(order: Order): void };
type LoyaltyLedger = {
  findAvailableByCustomer(customerId: string, at: Date): Promise<PointsLot[]>;
  getLotsByIds(ids: string[]): Promise<PointsLot[]>;
  saveLots(lots: PointsLot[]): Promise<void>;
  withCustomerLock<T>(customerId: string, action: () => Promise<T>): Promise<T>;
};
export type RedemptionResult =
  | { kind: "ok"; quote: PointsQuote }
  | { kind: "not-found" }
  | { kind: "invalid-state" }
  | { kind: "key-conflict" };

/**
 * Debit lots and record the exact result under one customer lock. The lock spans the
 * asynchronous ledger reads and writes, so two orders cannot spend one point twice.
 */
export async function redeemPoints(
  orders: OrderStore, loyalty: LoyaltyLedger, now: () => Date,
  orderId: string, customerId: string, requestedPoints: number, idempotencyKey: string,
): Promise<RedemptionResult> {
  return loyalty.withCustomerLock(customerId, async () => {
    const order = orders.get(orderId);
    if (!order || order.customerId !== customerId) return { kind: "not-found" };
    const prior = order.redemptions ?? [];
    const replay = prior.find(entry => entry.idempotencyKey === idempotencyKey);
    // Authorisation above always precedes replay; a retry returns its original stored result.
    if (replay) return replay.requestedPoints === requestedPoints
      ? { kind: "ok", quote: replay.quote } : { kind: "key-conflict" };
    if (order.status !== "pending") return { kind: "invalid-state" };

    const appliedBefore = prior.reduce((sum, entry) => sum + entry.appliedPoints, 0);
    const desired = quoteForOrderWithPoints(order, appliedBefore + requestedPoints).pointsAppliedCents - appliedBefore;
    const { allocations, changedLots } = await consumeEarliestLots(loyalty, customerId, desired, now());
    const appliedPoints = allocations.reduce((sum, allocation) => sum + allocation.points, 0);
    const quote = quoteForOrderWithPoints(order, appliedBefore + appliedPoints);
    const redemption: PointsRedemption = { idempotencyKey, requestedPoints, appliedPoints, allocations, quote };
    await loyalty.saveLots(changedLots);
    orders.save({ ...order, redemptions: [...prior, redemption] });
    return { kind: "ok", quote };
  });
}

async function consumeEarliestLots(
  loyalty: LoyaltyLedger, customerId: string, wanted: number, at: Date,
): Promise<{ allocations: PointsAllocation[]; changedLots: PointsLot[] }> {
  let remaining = wanted;
  const allocations: PointsAllocation[] = [];
  const changedLots: PointsLot[] = [];
  const lots = await loyalty.findAvailableByCustomer(customerId, at);
  for (const lot of lots) {
    if (remaining === 0) break;
    const points = Math.min(remaining, lot.points);
    remaining -= points;
    allocations.push({ lotId: lot.id, points });
    changedLots.push({ ...lot, points: lot.points - points });
  }
  return { allocations, changedLots };
}

/** Restore recorded allocations only when their original lots remain valid at cancellation. */
export async function cancelAndRestorePoints(
  orders: OrderStore, loyalty: LoyaltyLedger, now: () => Date, orderId: string, customerId: string,
): Promise<{ kind: "ok"; order: Order } | { kind: "not-found" } | { kind: "invalid-state" }> {
  return loyalty.withCustomerLock(customerId, async () => {
    const order = orders.get(orderId);
    if (!order || order.customerId !== customerId) return { kind: "not-found" };
    try {
      const cancelled = cancel(order);
      await restoreLots(loyalty, order.redemptions ?? [], now());
      orders.save(cancelled);
      return { kind: "ok", order: cancelled };
    } catch (error) {
      if (error instanceof OrderStateError) return { kind: "invalid-state" };
      throw error;
    }
  });
}

async function restoreLots(loyalty: LoyaltyLedger, redemptions: PointsRedemption[], at: Date): Promise<void> {
  const restored = new Map<string, number>();
  for (const redemption of redemptions) for (const allocation of redemption.allocations)
    restored.set(allocation.lotId, (restored.get(allocation.lotId) ?? 0) + allocation.points);
  const lots = await loyalty.getLotsByIds([...restored.keys()]);
  const changedLots = lots.filter(lot => !isExpired(lot, at)).map(lot => ({
    ...lot, points: lot.points + (restored.get(lot.id) ?? 0),
  }));
  await loyalty.saveLots(changedLots);
}
