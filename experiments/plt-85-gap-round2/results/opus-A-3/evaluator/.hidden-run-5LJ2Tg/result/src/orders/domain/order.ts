import type { Line } from "../../pricing/domain/quote.ts";

export type OrderStatus = "pending" | "shipped" | "cancelled";

/** Points used to pay part of an order, with the lots they were taken from. */
export type PointsRedemption = {
  idempotencyKey: string;
  points: number;
  allocations: { lotId: string; points: number }[];
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

/** Domain rule: only pending orders can be paid with points. Returns the new order value. */
export function addRedemption(order: Order, redemption: PointsRedemption): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, redemptions: [...(order.redemptions ?? []), redemption] };
}

export function pointsRedeemed(order: Order): number {
  return (order.redemptions ?? []).reduce((s, r) => s + r.points, 0);
}
