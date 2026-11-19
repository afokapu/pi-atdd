import type { Line, PointsQuote } from "../../pricing/domain/quote.ts";

export type OrderStatus = "pending" | "shipped" | "cancelled";

/** An allocation records the exact lot so cancellation never reruns FIFO. */
export type PointsAllocation = { lotId: string; points: number };
export type Redemption = {
  idempotencyKey: string;
  requestedPoints: number;
  allocations: PointsAllocation[];
  /** The first response is retained so retries never reprice a payment. */
  response: PointsQuote;
};

export type Order = {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: Line[];
  region: string;
  discountCode?: string;
  /** Successful point payments, retained for idempotency and cancellation. */
  redemptions?: Redemption[];
};

export class OrderStateError extends Error {}

/** Domain rule: only pending orders can be cancelled. Returns the new order value. */
export function cancel(order: Order): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "cancelled" };
}
