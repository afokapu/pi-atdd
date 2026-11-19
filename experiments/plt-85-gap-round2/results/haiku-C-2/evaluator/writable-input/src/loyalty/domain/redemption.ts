import type { Allocation } from "./points.ts";

/**
 * A points redemption against one order. Recorded with the order's lot allocations
 * so cancellation can restore exactly those points. `quote` is the original response,
 * replayed verbatim for the same idempotency key.
 */
export type RedemptionQuote = {
  region: string;
  subtotalCents: number;
  discountCents: number;
  pointsAppliedCents: number;
  taxCents: number;
  totalCents: number;
};

export type Redemption = {
  orderId: string;
  customerId: string;
  idempotencyKey: string;
  /** Points the client asked to spend (the applied amount may be lower). */
  points: number;
  allocations: Allocation[];
  quote: RedemptionQuote;
  status: "applied" | "reversed";
};
