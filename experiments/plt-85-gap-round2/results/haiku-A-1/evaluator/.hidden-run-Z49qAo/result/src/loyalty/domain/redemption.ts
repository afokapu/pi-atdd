import type { Allocation } from "./points.ts";

/** Customer-facing quote of an order paid partly with points (all integer cents). */
export type PointsQuote = {
  region: string;
  subtotalCents: number;
  discountCents: number;
  pointsAppliedCents: number;
  taxCents: number;
  totalCents: number;
};

/**
 * A points redemption against one order. Kept so that the same idempotency key
 * replays the same result, and so that cancelling the order can return the points.
 */
export type Redemption = {
  id: string;
  customerId: string;
  orderId: string;
  idempotencyKey: string;
  requestedPoints: number;
  pointsApplied: number;
  allocations: Allocation[];
  /** Quote returned to the customer; replayed verbatim for the same idempotency key. */
  result: PointsQuote;
  reversedAt?: Date;
};

/** Business rule violated by a redemption request (maps to HTTP 409). */
export class PointsConflictError extends Error {}
