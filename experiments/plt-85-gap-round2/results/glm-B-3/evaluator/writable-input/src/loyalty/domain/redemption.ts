import type { Consumption } from "./points.ts";

/**
 * Permanent record of one successful redemption: which points left which lots
 * to pay for which order. The idempotency key is unique per customer, the
 * recorded consumption is the source of truth for the refund on cancellation.
 */
export type RedemptionRecord = {
  idempotencyKey: string;
  customerId: string;
  orderId: string;
  /** Points the customer asked to spend (may exceed what was applied). */
  pointsRequested: number;
  /** Cents actually knocked off the order (= points consumed; 1 point = 1 cent). */
  pointsCents: number;
  /** Per-lot debits made for this redemption; the refund path replays these. */
  consumed: Consumption[];
};

/**
 * Idempotency rule: a key replays its stored result only when the repeated
 * request is identical (same order, same points). Any difference in the body
 * under the same key is a conflict and must be rejected, never re-executed.
 */
export function isSameRedemption(record: RedemptionRecord, orderId: string, points: number): boolean {
  return record.orderId === orderId && record.pointsRequested === points;
}
