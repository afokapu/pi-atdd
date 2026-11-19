import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { cancel, type Order } from "../domain/order.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import type { CustomerLock } from "../../loyalty/application/customer-lock.ts";
import { credit } from "../../loyalty/application/ledger.ts";

export type CancelDeps = { orders: InMemoryOrderStore; loyalty: InMemoryLoyaltyStore; lock: CustomerLock; now: () => Date };

/**
 * Cancel a pending order. Redeemed points go back to their original lots
 * (original expiry); points whose lot has expired by now are forfeited.
 * Returns undefined when the order does not exist or belongs to someone else.
 */
export function cancelOrder(deps: CancelDeps, customerId: string, orderId: string): Promise<Order | undefined> {
  return deps.lock.run(customerId, async () => {
    const order = deps.orders.get(orderId);
    if (!order || order.customerId !== customerId) return undefined;
    const cancelled = cancel(order);
    if (cancelled.redemption) {
      const refund = await credit(deps.loyalty, cancelled.redemption.allocations, deps.now());
      cancelled.redemption = { ...cancelled.redemption, refund };
    }
    deps.orders.save(cancelled);
    return cancelled;
  });
}
