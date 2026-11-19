import type { Line } from "../../pricing/domain/quote.ts";

export type OrderStatus = "pending" | "shipped" | "cancelled";

/** A debit is retained so cancellation can put points back in their source lots. */
export type PointsRedemption = {
  idempotencyKey: string;
  requestedPoints: number;
  pointsAppliedCents: number;
  /** Cumulative points on the order when this request completed. */
  quotePointsAppliedCents: number;
  lots: { lotId: string; points: number; expiresAt: Date }[];
};

export type Order = {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: Line[];
  region: string;
  discountCode?: string;
  redemptions?: PointsRedemption[];
};

export class OrderStateError extends Error {}

/** Domain rule: only pending orders can be cancelled. Returns the new order value. */
export function cancel(order: Order): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "cancelled" };
}
