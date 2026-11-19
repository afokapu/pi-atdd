import type { Line, PointsQuote } from "../../pricing/domain/quote.ts";

/** A recorded draw lets cancellation return points to exactly the lot they came from. */
export type PointsAllocation = { lotId: string; points: number };
export type PointsRedemption = {
  idempotencyKey: string;
  requestedPoints: number;
  appliedPoints: number;
  allocations: PointsAllocation[];
  quote: PointsQuote;
};

export type OrderStatus = "pending" | "shipped" | "cancelled";
export type Order = {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: Line[];
  region: string;
  discountCode?: string;
  /** Redemptions are retained both for idempotent replay and cancellation reversal. */
  redemptions?: PointsRedemption[];
};

export class OrderStateError extends Error {}

/** Domain rule: only pending orders can be cancelled. Returns the new order value. */
export function cancel(order: Order): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "cancelled" };
}
