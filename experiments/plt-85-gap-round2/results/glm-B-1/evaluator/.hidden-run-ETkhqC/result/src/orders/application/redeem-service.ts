import { redeem, type Order, type Redemption } from "../domain/order.ts";
import { isExpired, planConsumption } from "../../loyalty/domain/points.ts";
import { quoteOrderWithPoints } from "../../pricing/application/quote-service.ts";
import type { PointsQuote } from "../../pricing/domain/quote.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";

/** Route-ready outcome of a redemption attempt. */
export type RedeemOutcome =
  | { status: 200; body: PointsQuote }
  | { status: 409; body: { error: string } };

export type RedeemDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  /** Current time, which decides lot expiry for consumption and refunds. */
  now: () => Date;
};

const conflict = (error: string): RedeemOutcome => ({ status: 409, body: { error } });

/**
 * Use case: pay part of a pending order with loyalty points, and hand points
 * back when a redeemed order is cancelled. Every ledger mutation for one
 * customer runs on that customer's private promise chain: the loyalty store
 * is asynchronous, so without this serialization two concurrent redemptions
 * would both read the same lot balances and spend the same points twice.
 */
export class RedeemService {
  private deps: RedeemDeps;
  /** Per-customer task queues; each entry is the tail of that customer's chain. */
  private chains = new Map<string, Promise<unknown>>();

  constructor(deps: RedeemDeps) { this.deps = deps; }

  /** Redeem `points` on `order` (ownership is checked by the route). */
  redeemFor(order: Order, points: number, idempotencyKey: string): Promise<RedeemOutcome> {
    return this.exclusive(order.customerId, () => this.redeemLocked(order.id, order.customerId, points, idempotencyKey));
  }

  /**
   * Return a redeemed order's points to their original lots, keeping the lots'
   * original expiry. Lots that expired by cancellation time are forfeited.
   * The order is re-read inside the lock so a cancel racing a concurrent
   * redeem still sees (and refunds) the redemption once it has landed.
   */
  refundFor(order: Order): Promise<void> {
    return this.exclusive(order.customerId, async () => {
      const redemption = this.deps.orders.get(order.id)?.redemption;
      if (!redemption) return;
      const at = this.deps.now();
      for (const alloc of redemption.lots) {
        const lot = await this.deps.loyalty.getLot(alloc.lotId);
        if (!lot || isExpired(lot, at)) continue; // expired by cancellation: points forfeited
        await this.deps.loyalty.saveLot({ ...lot, points: lot.points + alloc.points });
      }
    });
  }

  /** Runs on the customer's chain, so lot balances and idempotency are stable. */
  private async redeemLocked(orderId: string, customerId: string, points: number, idempotencyKey: string): Promise<RedeemOutcome> {
    const order = this.deps.orders.get(orderId);
    if (!order || order.customerId !== customerId) return conflict("order not redeemable");
    if (order.redemption) return this.replay(order, order.redemption, points, idempotencyKey);
    if (order.status !== "pending") return conflict("order " + order.id + " is " + order.status);

    // Points pay the post-discount, pre-tax amount; 1 point = 1 cent caps the redemption there.
    const base = quoteOrderWithPoints(order, 0);
    const taxableCents = base.subtotalCents - base.discountCents;
    const lots = await this.deps.loyalty.lotsFor(customerId);
    const plan = planConsumption(lots, points, this.deps.now(), taxableCents);
    for (const alloc of plan.allocations) {
      const lot = await this.deps.loyalty.getLot(alloc.lotId);
      if (!lot) continue; // lot vanished between listing and reading: nothing to debit
      await this.deps.loyalty.saveLot({ ...lot, points: lot.points - alloc.points });
    }
    const redemption: Redemption = {
      idempotencyKey, pointsRequested: points, pointsApplied: plan.applied, lots: plan.allocations,
    };
    this.deps.orders.save(redeem(order, redemption));
    return { status: 200, body: quoteOrderWithPoints(order, plan.applied) };
  }

  /** Same key + same body replays the stored result; anything else is rejected. */
  private replay(order: Order, stored: Redemption, points: number, idempotencyKey: string): RedeemOutcome {
    if (stored.idempotencyKey !== idempotencyKey) return conflict("order already redeemed under another idempotency key");
    if (stored.pointsRequested !== points) return conflict("idempotency key reused with a different body");
    return { status: 200, body: quoteOrderWithPoints(order, stored.pointsApplied) };
  }

  /** Run `task` after every previously submitted task of this customer has settled. */
  private exclusive<T>(customerId: string, task: () => Promise<T>): Promise<T> {
    const key = "customer:" + customerId;
    const tail = (this.chains.get(key) ?? Promise.resolve()).then(task, task);
    this.chains.set(key, tail.catch(() => undefined)); // a failed task must not poison later ones
    return tail;
  }
}
