import type { Line } from "../../pricing/domain/quote.ts";

export type OrderStatus = "pending" | "shipped" | "cancelled";

/** One lot's contribution to a redemption; needed to refund points to their original lots. */
export type RedeemedLot = { lotId: string; points: number };

/** A redemption recorded on the order: what was requested, what was applied, which lots paid. */
export type Redemption = {
  idempotencyKey: string;
  pointsRequested: number;
  /** Points actually consumed: never more than requested, available, or the post-discount amount. */
  pointsApplied: number;
  lots: RedeemedLot[];
};

export type Order = {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: Line[];
  region: string;
  discountCode?: string;
  /** Set once the order has been (partly) paid with points. */
  redemption?: Redemption;
};

export class OrderStateError extends Error {}

/** Domain rule: only pending orders can be cancelled. Returns the new order value. */
export function cancel(order: Order): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "cancelled" };
}

/** Domain rule: only pending orders can be redeemed. Returns the new order value. */
export function redeem(order: Order, redemption: Redemption): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, redemption };
}
