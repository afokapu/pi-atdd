import { cancel, type Order, type OrderBook } from "../domain/order.ts";
import { reverseAllocations } from "../../loyalty/domain/redemption.ts";
import type { LoyaltyLedger } from "../../loyalty/application/ledger-port.ts";

/**
 * Use case: cancel a pending order. If the order paid with points, they go back to the
 * lots they were drawn from (same expiry). Points whose lot has expired by now are forfeited.
 * Runs under the customer's lock, the same one redemptions use.
 */
export type CancelDeps = { orders: OrderBook; loyalty: LoyaltyLedger; now: () => Date };

/** Resolves to the cancelled order, or `undefined` if the order is not this customer's. Throws OrderStateError if not pending. */
export function cancelOrder(deps: CancelDeps, customerId: string, orderId: string): Promise<Order | undefined> {
  return deps.loyalty.withCustomerLock(customerId, async () => {
    const order = deps.orders.get(orderId);
    if (!order || order.customerId !== customerId) return undefined;
    const cancelled = cancel(order);
    await returnRedeemedPoints(deps.loyalty, orderId, deps.now());
    deps.orders.save(cancelled);
    return cancelled;
  });
}

/** Restores an order's allocations once. Forfeited points are dropped, not reissued. */
async function returnRedeemedPoints(loyalty: LoyaltyLedger, orderId: string, at: Date): Promise<void> {
  const redemption = await loyalty.redemptionForOrder(orderId);
  if (!redemption || redemption.reversed) return;
  const lots = await loyalty.getLots(redemption.allocations.map(a => a.lotId));
  const { restored } = reverseAllocations(lots, redemption.allocations, at);
  for (const lot of restored) await loyalty.saveLot(lot);
  await loyalty.saveRedemption({ ...redemption, reversed: true });
}
