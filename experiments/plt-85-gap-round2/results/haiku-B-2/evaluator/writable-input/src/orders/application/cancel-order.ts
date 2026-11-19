import { cancel, type Order } from "../domain/order.ts";
import { restorable } from "../../loyalty/domain/points.ts";
import { withCustomerLock, adjustLot } from "../../loyalty/application/ledger.ts";
import { loadOwnedOrder, type OrderUseCaseDeps } from "./owned-order.ts";

/**
 * Use case: cancel a pending order. Points it redeemed go back to their original lots,
 * except points whose lot has expired by now, which are forfeited.
 */
export function cancelOrder(deps: OrderUseCaseDeps, orderId: string, customerId: string): Promise<Order> {
  return withCustomerLock(customerId, async () => {
    const order = loadOwnedOrder(deps.orders, orderId, customerId);
    const cancelled = cancel(order);
    for (const a of restorable(order.redemption?.allocations ?? [], deps.now())) {
      await adjustLot(deps.loyalty, customerId, a, a.points);
    }
    deps.orders.save(cancelled);
    return cancelled;
  });
}
