/**
 * Redemption ledger entry (domain record). One record per (customer,
 * idempotencyKey): it captures the request fingerprint for replay decisions,
 * the exact lot allocations made at consumption time for an exact reversal,
 * and the full original response so the same key replays it verbatim.
 */
import type { PointAllocation } from "./points.ts";

export type RedemptionStatus = "held" | "reversed";

export type Redemption = {
  customerId: string;
  orderId: string;
  idempotencyKey: string;
  /** Fingerprint of the normalised request payload (see redemptionFingerprint). */
  fingerprint: string;
  /** Points this redemption applied to the order (1 point = 1 cent). */
  appliedCents: number;
  /** Lots drawn and how much, persisted together with the consumption. */
  allocations: PointAllocation[];
  /** Full original response, replayed verbatim for the same key and payload. */
  response: { status: number; body: unknown };
  status: RedemptionStatus;
};

/**
 * Fingerprint of the normalised payload: only the fields the endpoint accepts,
 * in a fixed order, so semantically equal bodies always fingerprint equal and
 * any differing body fingerprints different.
 */
export function redemptionFingerprint(input: { points: number; idempotencyKey: string }): string {
  return JSON.stringify({ points: input.points, idempotencyKey: input.idempotencyKey });
}
