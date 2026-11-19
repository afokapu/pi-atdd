import type { PointsLot } from "../../loyalty/domain/points.ts";
import { isExpired } from "../../loyalty/domain/points.ts";
import type { PointsQuote } from "../../pricing/domain/quote.ts";
import { quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import { cancel, type Order, type PointsAllocation, type Redemption } from "../domain/order.ts";

/** Ports keep the use case independent of the in-memory adapter implementation. */
export type RedemptionOrders = { get(id: string): Order | undefined; save(order: Order): void };
export type RedemptionLedger = {
  withCustomerLock<T>(customerId: string, operation: () => Promise<T>): Promise<T>;
  findValidByCustomer(customerId: string, at: Date): Promise<PointsLot[]>;
  getLotsByIds(ids: string[]): Promise<PointsLot[]>;
  saveLot(lot: PointsLot): Promise<void>;
};
export type RedeemResult =
  | { kind: "ok"; quote: PointsQuote }
  | { kind: "not-found" }
  | { kind: "not-pending" }
  | { kind: "key-conflict" };

/**
 * Redeem in a customer-scoped critical section: lot debits and the response
 * journal are committed together, so async I/O cannot double-spend a lot.
 */
export async function redeemOrder(
  orders: RedemptionOrders, ledger: RedemptionLedger, now: () => Date,
  customerId: string, orderId: string, points: number, idempotencyKey: string,
): Promise<RedeemResult> {
  return ledger.withCustomerLock(customerId, async () => {
    const order = orders.get(orderId);
    if (!order || order.customerId !== customerId) return { kind: "not-found" };
    const prior = order.redemptions?.find(redemption => redemption.idempotencyKey === idempotencyKey);
    if (prior) return prior.requestedPoints === points
      ? { kind: "ok", quote: prior.response }
      : { kind: "key-conflict" };
    if (order.status !== "pending") return { kind: "not-pending" };

    const alreadyApplied = appliedPoints(order.redemptions);
    const currentQuote = quoteForOrderWithPoints(order, alreadyApplied);
    const availableForOrder = currentQuote.subtotalCents - currentQuote.discountCents - alreadyApplied;
    const allocations = await consumeLots(ledger, customerId, now(), Math.min(points, availableForOrder));
    const quote = quoteForOrderWithPoints(order, alreadyApplied + allocatedPoints(allocations));
    const redemption: Redemption = { idempotencyKey, requestedPoints: points, allocations, response: quote };
    orders.save({ ...order, redemptions: [...(order.redemptions ?? []), redemption] });
    return { kind: "ok", quote };
  });
}

/** Restore recorded allocations once; expired lots are intentionally forfeited. */
export async function cancelRedeemedOrder(
  orders: RedemptionOrders, ledger: RedemptionLedger, now: () => Date, customerId: string, orderId: string,
): Promise<{ kind: "ok"; order: Order } | { kind: "not-found" } | { kind: "not-pending" }> {
  return ledger.withCustomerLock(customerId, async () => {
    const order = orders.get(orderId);
    if (!order || order.customerId !== customerId) return { kind: "not-found" };
    if (order.status !== "pending") return { kind: "not-pending" };
    const allocations = order.redemptions?.flatMap(redemption => redemption.allocations) ?? [];
    await restoreUnexpiredLots(ledger, allocations, now());
    const cancelled = cancel(order);
    orders.save(cancelled);
    return { kind: "ok", order: cancelled };
  });
}

function appliedPoints(redemptions: Redemption[] | undefined): number {
  return (redemptions ?? []).reduce((sum, redemption) => sum + allocatedPoints(redemption.allocations), 0);
}

function allocatedPoints(allocations: PointsAllocation[]): number {
  return allocations.reduce((sum, allocation) => sum + allocation.points, 0);
}

async function consumeLots(ledger: RedemptionLedger, customerId: string, at: Date, wanted: number): Promise<PointsAllocation[]> {
  const allocations: PointsAllocation[] = [];
  let remaining = wanted;
  for (const lot of await ledger.findValidByCustomer(customerId, at)) {
    if (remaining === 0) break;
    const points = Math.min(lot.points, remaining);
    await ledger.saveLot({ ...lot, points: lot.points - points });
    allocations.push({ lotId: lot.id, points });
    remaining -= points;
  }
  return allocations;
}

async function restoreUnexpiredLots(ledger: RedemptionLedger, allocations: PointsAllocation[], at: Date): Promise<void> {
  const restored = allocationsByLot(allocations);
  const lots = await ledger.getLotsByIds([...restored.keys()]);
  await Promise.all(lots.filter(lot => !isExpired(lot, at)).map(lot =>
    ledger.saveLot({ ...lot, points: lot.points + restored.get(lot.id)! })));
}

function allocationsByLot(allocations: PointsAllocation[]): Map<string, number> {
  return allocations.reduce((amounts, allocation) => {
    amounts.set(allocation.lotId, (amounts.get(allocation.lotId) ?? 0) + allocation.points);
    return amounts;
  }, new Map<string, number>());
}
