import type { Line, PricedQuote } from "../../pricing/domain/quote.ts";
import type { PointsAllocation } from "../../loyalty/domain/points.ts";

export type OrderStatus = "pending" | "shipped" | "cancelled";
/**
 * Points spent on an order: which lots they came from and the quote they produced.
 * Kept on the order so a retry with the same key replays it and a cancel can return the points.
 */
export type Redemption = {
  idempotencyKey: string;
  requestedPoints: number;
  allocations: PointsAllocation[];
  quote: PricedQuote;
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
