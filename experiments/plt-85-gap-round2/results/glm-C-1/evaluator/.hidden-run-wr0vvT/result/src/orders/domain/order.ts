import type { Line } from "../../pricing/domain/quote.ts";

export type OrderStatus = "pending" | "shipped" | "cancelled";

/**
 * Points drawn per lot by a redemption, kept on the order so cancellation can
 * return every allocation to its original lot. Declared locally (structurally
 * identical to the loyalty domain's `Allocation`) to keep the two domains
 * decoupled.
 */
export type RedemptionAllocation = { lotId: string; points: number };

export type Redemption = { points: number; allocations: RedemptionAllocation[] };

export type Order = {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: Line[];
  region: string;
  discountCode?: string;
  /** Set once the order has been (part-)paid with loyalty points. */
  redemption?: Redemption;
};

export class OrderStateError extends Error {}

/** Domain rule: only pending orders can be cancelled. Returns the new order value. */
export function cancel(order: Order): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "cancelled" };
}

/** Domain rule: only a pending, not-yet-redeemed order can be redeemed. Throws otherwise. */
export function assertRedeemable(order: Order): void {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  if (order.redemption) throw new OrderStateError("order " + order.id + " already redeemed");
}

/** Domain rule: apply a redemption to an eligible order. Returns the new order value. */
export function redeem(order: Order, redemption: Redemption): Order {
  assertRedeemable(order);
  return { ...order, redemption };
}
