import type { Order } from "../../orders/domain/order.ts";

export type ShippedOrder = Order & { status: "shipped" };

/** Domain rule: mark an order as shipped. */
export function shipOrder(order: Order): ShippedOrder {
  if (order.status === "cancelled") throw new Error("cancelled orders cannot be shipped");
  return { ...order, status: "shipped" };
}
