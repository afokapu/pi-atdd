import type { Line } from "../../pricing/domain/quote.ts";

export type OrderStatus = "pending" | "redeemed" | "shipped" | "cancelled";

/** The exact lots and response recorded when loyalty points were redeemed. */
export type Redemption = {
  readonly idempotencyKey: string;
  readonly requestedPoints: number;
  readonly allocations: readonly { readonly lotId: string; readonly points: number }[];
  readonly quote: {
    readonly region: string;
    readonly subtotalCents: number;
    readonly discountCents: number;
    readonly pointsAppliedCents: number;
    readonly taxCents: number;
    readonly totalCents: number;
  };
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

/** A pending order, including one paid partly with points, may be cancelled. */
export function cancel(order: Order): Order {
  if (order.status !== "pending" && order.status !== "redeemed")
    throw new OrderStateError("order " + order.id + " is " + order.status);
  return { ...order, status: "cancelled" };
}
