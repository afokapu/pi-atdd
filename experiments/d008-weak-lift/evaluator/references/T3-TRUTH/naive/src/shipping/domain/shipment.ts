import type { Order } from "../../orders/domain/order.ts";

export type ShippedOrder = Order & { status: "shipped" };

/** Domain rule: mark an order as shipped. */
export function shipOrder(order: Order): ShippedOrder {
  if (order.status === "shipped") throw new Error("order has already shipped");
  return { ...order, status: "shipped" };
}
