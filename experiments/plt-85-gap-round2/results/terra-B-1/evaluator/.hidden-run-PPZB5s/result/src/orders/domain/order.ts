import type { Line } from "../../pricing/domain/quote.ts";

export type OrderStatus = "pending" | "redeemed" | "shipped" | "cancelled";
export type Order = {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: Line[];
  region: string;
  discountCode?: string;
};

export class OrderStateError extends Error {}

/** A redeemed order is still cancellable so its held points can be returned. */
export function cancel(order: Order): Order {
  if (order.status !== "pending" && order.status !== "redeemed") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "cancelled" };
}

/** Redemption finalises the points payment while retaining cancellation eligibility. */
export function redeem(order: Order): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "redeemed" };
}
