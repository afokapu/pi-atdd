import type { Line } from "../../pricing/domain/quote.ts";

export type OrderStatus = "pending" | "shipped" | "cancelled";

/** Loyalty points used to pay part of the order, and the lots they came from. */
export type Redemption = {
  idempotencyKey: string;
  points: number;
  pointsCents: number;
  allocations: { lotId: string; points: number }[];
  /** Set when the order is cancelled: points put back vs. forfeited (lot expired). */
  refund?: { returnedPoints: number; forfeitedPoints: number };
};

export type Order = {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: Line[];
  region: string;
  discountCode?: string;
  redemption?: Redemption;
};

export class OrderStateError extends Error {}

/** Domain rule: only pending orders can be cancelled. Returns the new order value. */
export function cancel(order: Order): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "cancelled" };
}

/** Domain rule: points can be redeemed once, on a pending order. */
export function assertRedeemable(order: Order): void {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  if (order.redemption) throw new OrderStateError("points already redeemed on order " + order.id);
}

export function redeem(order: Order, redemption: Redemption): Order {
  assertRedeemable(order);
  return { ...order, redemption };
}
