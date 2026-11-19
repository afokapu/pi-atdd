import type { Allocation } from "./points.ts";

/** The priced result of a redemption, stored so that an idempotent replay returns the same answer. */
export type RedemptionQuote = {
  region: string;
  subtotalCents: number;
  discountCents: number;
  pointsAppliedCents: number;
  taxCents: number;
  totalCents: number;
};

/** Ledger record of points spent on one order, keyed by (customer, idempotency key). */
export type Redemption = {
  customerId: string;
  idempotencyKey: string;
  orderId: string;
  /** Identifies the request body; the same key with a different fingerprint is a conflict. */
  requestFingerprint: string;
  allocations: Allocation[];
  quote: RedemptionQuote;
};
