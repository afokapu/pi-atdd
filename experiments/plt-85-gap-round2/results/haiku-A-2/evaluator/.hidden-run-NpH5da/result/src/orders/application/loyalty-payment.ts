import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import { allocatePoints, isExpired, pointsToCents, type Consumption } from "../../loyalty/domain/points.ts";
import { assertPending, cancel, OrderStateError, type Order } from "../domain/order.ts";
import { quoteForOrder } from "../../pricing/application/quote-service.ts";
import type { KeyedMutex } from "./keyed-mutex.ts";

export type Outcome = { status: number; body: unknown };

export type LoyaltyPaymentDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  now: () => Date;
  /** Shared per-customer lock: every points operation of one customer runs one at a time. */
  locks: KeyedMutex;
};

export type RedeemInput = { points: number; idempotencyKey: string };

const notFound: Outcome = { status: 404, body: { error: "order not found" } };
const conflict = (message: string): Outcome => ({ status: 409, body: { error: message } });

const pointsOf = (taken: Consumption[]) => taken.reduce((sum, c) => sum + c.points, 0);

/**
 * Pay part of a pending order with points. Points apply after discounts and before tax,
 * never exceed what is payable, and come only from lots not yet expired (earliest first).
 * Replaying the same idempotency key with the same request returns the recorded answer;
 * reusing it for a different request is a conflict.
 */
export function redeemPoints(deps: LoyaltyPaymentDeps, customerId: string, orderId: string, input: RedeemInput): Promise<Outcome> {
  const fingerprint = JSON.stringify([orderId, input.points]);
  return deps.locks.run(customerId, async () => {
    const recorded = await deps.loyalty.getResponse(customerId, input.idempotencyKey);
    if (recorded) {
      return recorded.fingerprint === fingerprint
        ? { status: recorded.status, body: recorded.body }
        : conflict("idempotency key already used for a different request");
    }

    const order = deps.orders.get(orderId);
    if (!order || order.customerId !== customerId) return notFound;
    try { assertPending(order); } catch (e) {
      if (e instanceof OrderStateError) return conflict(e.message);
      throw e;
    }

    const base = quoteForOrder(order);
    const alreadyCents = pointsToCents(pointsOf(await deps.loyalty.getRedemption(orderId)));
    const capCents = base.subtotalCents - base.discountCents - alreadyCents;
    const lots = await deps.loyalty.lotsFor(customerId);
    const plan = allocatePoints(lots, Math.min(input.points, capCents), deps.now());

    for (const c of plan) {
      const lot = lots.find(l => l.id === c.lotId)!;
      await deps.loyalty.saveLot({ ...lot, points: lot.points - c.points });
    }
    if (plan.length > 0) await deps.loyalty.addRedemption(orderId, plan);

    const appliedCents = alreadyCents + pointsToCents(pointsOf(plan));
    const body = { ...quoteForOrder(order, appliedCents), pointsAppliedCents: appliedCents };
    await deps.loyalty.saveResponse(customerId, input.idempotencyKey, { fingerprint, status: 200, body });
    return { status: 200, body };
  });
}

/**
 * Cancel a pending order. Points it consumed go back to their original lots (original expiry);
 * points whose lot has expired by now are forfeited.
 */
export function cancelOrder(deps: LoyaltyPaymentDeps, customerId: string, orderId: string): Promise<Outcome> {
  return deps.locks.run(customerId, async () => {
    const order = deps.orders.get(orderId);
    if (!order || order.customerId !== customerId) return notFound;

    let cancelled: Order;
    try { cancelled = cancel(order); } catch (e) {
      if (e instanceof OrderStateError) return conflict(e.message);
      throw e;
    }

    const now = deps.now();
    for (const c of await deps.loyalty.getRedemption(orderId)) {
      const lot = await deps.loyalty.getLot(c.lotId);
      if (!lot || isExpired(lot, now)) continue;
      await deps.loyalty.saveLot({ ...lot, points: lot.points + c.points });
    }
    deps.orders.save(cancelled);
    return { status: 200, body: cancelled };
  });
}
