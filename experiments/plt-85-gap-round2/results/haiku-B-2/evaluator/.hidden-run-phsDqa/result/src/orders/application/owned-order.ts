import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import type { Order } from "../domain/order.ts";

/** Collaborators shared by the order use cases. The composition root supplies them. */
export type OrderUseCaseDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  now: () => Date;
};

/** Raised for a missing order and for one owned by someone else; the two are not distinguished to callers. */
export class OrderNotFoundError extends Error {}

export function loadOwnedOrder(orders: InMemoryOrderStore, orderId: string, customerId: string): Order {
  const order = orders.get(orderId);
  if (!order || order.customerId !== customerId) throw new OrderNotFoundError("order not found");
  return order;
}
