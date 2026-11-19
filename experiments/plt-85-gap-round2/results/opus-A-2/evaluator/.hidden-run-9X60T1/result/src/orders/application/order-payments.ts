import { cancel, OrderStateError, pointsRedeemed, type Order } from "../domain/order.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { Ledger } from "../../loyalty/application/ledger.ts";
import { pointsToCents } from "../../loyalty/domain/points.ts";
import { pointsPayableCents, type PointsQuote } from "../../pricing/domain/quote.ts";
import { quoteForOrder, quoteWithPoints } from "../../pricing/application/quote-service.ts";
import type { KeyedLock } from "../../shared/keyed-lock.ts";

export class OrderNotFoundError extends Error {}
export class IdempotencyConflictError extends Error {}

export type RedeemRequest = { orderId: string; points: number; idempotencyKey: string };

/** Recorded outcome of a redemption, keyed by (customer, idempotency key). */
type IdempotencyRecord = { orderId: string; points: number; result: PointsQuote };
export type IdempotencyStore = Map<string, IdempotencyRecord>;

export type OrderPaymentDeps = {
  orders: InMemoryOrderStore;
  ledger: Ledger;
  /** Serialises all point-moving operations of one customer. */
  customerLock: KeyedLock;
  idempotency: IdempotencyStore;
  now: () => Date;
};

/** Current quote of an order including the points already applied. */
export function currentQuote(order: Order): PointsQuote {
  const pts = pointsRedeemed(order);
  return quoteWithPoints(order, pts, pointsToCents(pts));
}

/**
 * LOY-002: pay part of a pending order with loyalty points.
 * Points are capped at the remaining amount after discount (before tax); excess is not consumed.
 */
export function redeemPoints(deps: OrderPaymentDeps, customerId: string, req: RedeemRequest): Promise<PointsQuote> {
  return deps.customerLock.run(customerId, async () => {
    const idemKey = customerId + "\u0000" + req.idempotencyKey;
    const prior = deps.idempotency.get(idemKey);
    if (prior) {
      if (prior.orderId !== req.orderId || prior.points !== req.points)
        throw new IdempotencyConflictError("idempotency key reused with a different request");
      return prior.result;
    }

    const order = deps.orders.get(req.orderId);
    if (!order || order.customerId !== customerId) throw new OrderNotFoundError("order not found");
    if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);

    const alreadyCents = pointsToCents(pointsRedeemed(order));
    const remainingCents = Math.max(0, pointsPayableCents(quoteForOrder(order)) - alreadyCents);
    // 1 point = 1 cent, so the cap in points equals the remaining cents.
    const toConsume = Math.min(req.points, remainingCents);

    const allocations = await deps.ledger.spend(customerId, toConsume, deps.now());
    const updated: Order = {
      ...order,
      redemptions: [...(order.redemptions ?? []),
        { idempotencyKey: req.idempotencyKey, points: toConsume, allocations }],
    };
    deps.orders.save(updated);
    const result = currentQuote(updated);
    deps.idempotency.set(idemKey, { orderId: req.orderId, points: req.points, result });
    return result;
  });
}

/** Cancel an order and return any redeemed points to their original lots. */
export function cancelOrder(deps: OrderPaymentDeps, customerId: string, orderId: string): Promise<Order> {
  return deps.customerLock.run(customerId, async () => {
    const order = deps.orders.get(orderId);
    if (!order || order.customerId !== customerId) throw new OrderNotFoundError("order not found");
    const cancelled = cancel(order); // throws OrderStateError if not pending
    const allocations = (order.redemptions ?? []).flatMap(r => r.allocations);
    await deps.ledger.giveBack(customerId, allocations, deps.now());
    deps.orders.save(cancelled);
    return cancelled;
  });
}
