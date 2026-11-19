import type { Line } from "../../pricing/domain/quote.ts";

export type OrderStatus = "pending" | "shipped" | "cancelled";
export type Order = {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: Line[];
  region: string;
  discountCode?: string;
  /** Points already applied to this order, if any. */
  redemption?: Redemption;
};

export class OrderStateError extends Error {}

/** Points one order consumed from a single loyalty lot. */
export type RedeemedLot = { lotId: string; points: number };

/** Bookkeeping of the points an order has paid with (kept so cancellation can refund them). */
export type Redemption = {
  /** Total points applied to the order so far. */
  points: number;
  /** Per-lot consumption, so refunds can go back to the original lots. */
  lots: RedeemedLot[];
};

/** Domain rule: only pending orders can be cancelled. Returns the new order value. */
export function cancel(order: Order): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "cancelled" };
}

/**
 * Domain rule: only pending orders can be redeemed. Records `appliedPoints`
 * plus the per-lot consumption (merged with any previous redemption of the
 * order). Returns the new order value.
 */
export function applyRedemption(order: Order, appliedPoints: number, consumed: RedeemedLot[]): Order {
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  const perLot = new Map<string, number>();
  for (const l of order.redemption?.lots ?? []) perLot.set(l.lotId, (perLot.get(l.lotId) ?? 0) + l.points);
  for (const c of consumed) perLot.set(c.lotId, (perLot.get(c.lotId) ?? 0) + c.points);
  const redemption: Redemption = {
    points: (order.redemption?.points ?? 0) + appliedPoints,
    lots: [...perLot].map(([lotId, points]) => ({ lotId, points })),
  };
  return { ...order, redemption };
}
