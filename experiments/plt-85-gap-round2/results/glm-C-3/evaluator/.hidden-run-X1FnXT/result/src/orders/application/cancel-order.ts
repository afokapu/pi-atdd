import { cancel, OrderStateError, type Order } from "../domain/order.ts";
import { customerLockKey, type OwnerLocks } from "../../loyalty/application/owner-locks.ts";
import type { ReversalResult } from "../../loyalty/application/release-points.ts";

export type CancelOrderDeps = {
  orders: { get(id: string): Order | undefined; save(order: Order): void };
  locks: OwnerLocks;
  /** Pre-wired release of the order's point redemptions (loyalty context). */
  releaseRedemptions: (orderId: string) => Promise<ReversalResult>;
};

/**
 * Use case: cancel a pending order and give back the points it redeemed.
 * Runs inside the customer's critical section — the same lock redemption uses
 * — so a cancel can never interleave with a redeem moving the same points.
 */
export function cancelOrder(deps: CancelOrderDeps, cmd: { orderId: string; customerId: string }) {
  return deps.locks.run(customerLockKey(cmd.customerId), async () => {
    const order = deps.orders.get(cmd.orderId);
    if (!order || order.customerId !== cmd.customerId) return { status: 404, body: { error: "order not found" } };
    try {
      const cancelled = cancel(order); // domain rule: only pending orders can be cancelled
      deps.orders.save(cancelled);
      await deps.releaseRedemptions(cmd.orderId);
      return { status: 200, body: cancelled };
    } catch (e) {
      if (e instanceof OrderStateError) return { status: 409, body: { error: e.message } };
      throw e;
    }
  });
}
