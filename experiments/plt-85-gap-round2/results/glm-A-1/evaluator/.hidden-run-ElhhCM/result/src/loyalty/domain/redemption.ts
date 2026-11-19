import type { LotConsumption } from "./redeem.ts";

/** Quote of an order including the loyalty points applied to it (all amounts in cents). */
export type RedemptionQuote = {
  region: string;
  subtotalCents: number;
  discountCents: number;
  pointsCents: number;
  taxCents: number;
  totalCents: number;
};

/** A redemption: points taken from a customer's lots to (partly) pay a pending order. */
export type Redemption = {
  id: string;
  customerId: string;
  orderId: string;
  idempotencyKey: string;
  /** Points the caller asked for. */
  requestedPoints: number;
  /** Points actually taken from lots (capped by lot balance and the discounted amount). */
  appliedPoints: number;
  /** Order quote including all points applied to the order. */
  quote: RedemptionQuote;
  /** Points consumed per lot; returned to these lots on cancellation. */
  lots: LotConsumption[];
  createdAt: Date;
  /** Set when a cancellation returned the points to their lots. */
  restoredAt?: Date;
};
