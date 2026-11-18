export type OrderStatus = "pending" | "shipped" | "cancelled";
export type Order = { id: string; customerId: string; status: OrderStatus; items: string[] };

export class OrderStateError extends Error {}

/** Domain rule: only pending orders can be cancelled. Returns the new order value. */
export function cancel(order: Order): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "cancelled" };
}
