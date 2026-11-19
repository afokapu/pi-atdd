import type { Line } from "../../pricing/domain/quote.ts";

export type OrderStatus = "pending" | "shipped" | "cancelled";
export type Order = {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: Line[];
  region: string;
  discountCode?: string;
  /** Loyalty-points payments made on this order (see LOY-002). */
  redemptions?: Redemption[];
};

/** One points payment: which lots it consumed and how much (1 point = 1 cent). */
export type Redemption = {
  idempotencyKey: string;
  points: number;
  allocations: { lotId: string; points: number }[];
};

/** Total points applied to an order. */
export function pointsRedeemed(order: Order): number {
  return (order.redemptions ?? []).reduce((s, r) => s + r.points, 0);
}

export class OrderStateError extends Error {}

/** Domain rule: only pending orders can be cancelled. Returns the new order value. */
export function cancel(order: Order): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "cancelled" };
}
