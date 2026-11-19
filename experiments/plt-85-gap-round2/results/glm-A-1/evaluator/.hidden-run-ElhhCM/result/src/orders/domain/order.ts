import type { Line } from "../../pricing/domain/quote.ts";

export type OrderStatus = "pending" | "shipped" | "cancelled";
export type Order = {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: Line[];
  region: string;
  discountCode?: string;
};

export class OrderStateError extends Error {}

/** Domain rule: an order must be pending for state-changing actions like cancel or redeem. */
export function requirePending(order: Order): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return order;
}

/** Domain rule: only pending orders can be cancelled. Returns the new order value. */
export function cancel(order: Order): Order {
  return { ...requirePending(order), status: "cancelled" };
}
