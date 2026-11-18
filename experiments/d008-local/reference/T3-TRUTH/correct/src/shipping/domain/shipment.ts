import type { Order } from "../../orders/domain/order.ts";

export type ShippedOrder = Order & { status: "shipped" };

/** Domain rule: mark an order as shipped. */
export class NotShippableError extends Error {}

export function shipOrder(order: Order): ShippedOrder {
  if (order.status === "cancelled") throw new NotShippableError("cancelled order " + order.id + " cannot be shipped");
  return { ...order, status: "shipped" };
}
