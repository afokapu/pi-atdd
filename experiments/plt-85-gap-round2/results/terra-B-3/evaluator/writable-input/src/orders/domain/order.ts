import type { Line } from "../../pricing/domain/quote.ts";

export type OrderStatus = "pending" | "shipped" | "cancelled";

/** Immutable record of a lot debit, retained so cancellation can restore it. */
export type RedeemedLot = { lotId: string; points: number; expiresAt: Date };
export type Redemption = {
  idempotencyKey: string;
  requestedPoints: number;
  appliedPoints: number;
  /** Cumulative amount at this operation, used to replay its original quote. */
  pointsAppliedAfter: number;
  lots: RedeemedLot[];
};

export type Order = {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: Line[];
  region: string;
  discountCode?: string;
  redemptions?: Redemption[];
};

export class OrderStateError extends Error {}

/** Domain rule: only pending orders can be cancelled. Returns the new order value. */
export function cancel(order: Order): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "cancelled" };
}
