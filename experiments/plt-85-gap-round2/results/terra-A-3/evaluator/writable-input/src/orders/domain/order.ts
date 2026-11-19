import type { Line } from "../../pricing/domain/quote.ts";

export type OrderStatus = "pending" | "shipped" | "cancelled";
export type Order = {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: Line[];
  region: string;
  discountCode?: string;
  /** Points already redeemed against this order, expressed in cents. */
  pointsAppliedCents?: number;
};

export class OrderStateError extends Error {}

/** Domain rule: only pending orders can be cancelled. Returns the new order value. */
export function cancel(order: Order): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "cancelled" };
}
