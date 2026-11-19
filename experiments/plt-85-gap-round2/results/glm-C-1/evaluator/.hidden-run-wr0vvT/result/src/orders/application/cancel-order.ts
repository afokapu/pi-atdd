/**
 * Use case: cancel a pending order, returning any redeemed loyalty points to
 * their original lots.
 *
 * Cancellation shares the loyalty ledger's per-customer critical section with
 * redemption: the state flip and the point restoration are one atomic step,
 * so a concurrent redemption can neither interleave with the reversal nor
 * lose the redemption record it depends on.
 */
import { planRestoration } from "../../loyalty/domain/points.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import { cancel } from "../domain/order.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { applyRestoration } from "./redeem-order.ts";

export type CancelDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  /** Clock used to decide which lots have expired and forfeit. */
  now: () => Date;
};

/**
 * Cancel order `orderId` for its owner. A redeemed order's allocations are
 * restored to their original lots exactly once (the pending-only status rule
 * guards re-entry); allocations whose lot expired by `now` are forfeited.
 */
export async function cancelOrder(deps: CancelDeps, orderId: string, customerId: string) {
  return deps.loyalty.runExclusive(customerId, async () => {
    const order = deps.orders.get(orderId);
    if (!order || order.customerId !== customerId) return { status: 404, body: { error: "order not found" } };
    const cancelled = cancel(order); // throws OrderStateError unless pending
    if (cancelled.redemption) {
      const lots = await deps.loyalty.lotsFor(customerId);
      // Restore from the recorded allocations only — never from current
      // balances — and forfeit whatever expired since consumption.
      const { restorations } = planRestoration(lots, cancelled.redemption.allocations, deps.now());
      await applyRestoration(deps.loyalty, restorations);
    }
    deps.orders.save(cancelled);
    return { status: 200, body: cancelled };
  });
}
