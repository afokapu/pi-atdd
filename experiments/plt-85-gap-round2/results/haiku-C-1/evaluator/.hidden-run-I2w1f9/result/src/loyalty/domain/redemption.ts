import { isExpired, type PointsLot } from "./points.ts";

/**
 * Loyalty redemption rules (LOY-002): how many points can pay, which lots they come
 * from, and how a cancelled redemption gives them back. Pure functions: the caller
 * supplies the lots (already filtered to non-expired ones) and the clock's instant.
 */

/** 100 points = 1 EUR = 100 cents, so one point is worth exactly one cent. */
const CENTS_PER_POINT = 1;

export const pointsToCents = (points: number): number => points * CENTS_PER_POINT;
export const centsToPoints = (cents: number): number => cents / CENTS_PER_POINT;

/** Points taken from one lot by one redemption. Recorded so a cancel can restore them to the same lot. */
export type Allocation = { lotId: string; points: number };

/**
 * The durable record of one redemption. `fingerprint` identifies the request body for
 * idempotent replay; `quote` is the response returned to the customer and replayed verbatim.
 */
export type Redemption<Q = unknown> = {
  customerId: string;
  orderId: string;
  idempotencyKey: string;
  fingerprint: string;
  allocations: Allocation[];
  quote: Q;
  reversed: boolean;
};

export function redemptionFingerprint(orderId: string, points: number): string {
  return JSON.stringify({ orderId, points });
}

/**
 * Points that may be applied: the requested amount, capped by the payable amount
 * (after discount) and by the usable points. Excess points are never consumed.
 */
export function applicablePointsCents(requestedPoints: number, payableCents: number, usable: PointsLot[]): number {
  const available = usable.reduce((sum, lot) => sum + lot.points, 0);
  return Math.max(0, Math.min(pointsToCents(requestedPoints), payableCents, pointsToCents(available)));
}

/**
 * Take `points` from usable lots, earliest expiry first (ties broken by id so the result is
 * deterministic). The caller must have checked the points are available.
 */
export function allocatePoints(usable: PointsLot[], points: number): Allocation[] {
  const earliestFirst = [...usable].sort(
    (a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id),
  );
  const allocations: Allocation[] = [];
  let remaining = points;
  for (const lot of earliestFirst) {
    if (remaining === 0) break;
    const take = Math.min(lot.points, remaining);
    if (take === 0) continue;
    allocations.push({ lotId: lot.id, points: take });
    remaining -= take;
  }
  if (remaining !== 0) throw new RangeError("not enough usable points to allocate");
  return allocations;
}

/** The lots changed by an allocation, with their remaining points reduced. Expiry is untouched. */
export function debit(usable: PointsLot[], allocations: Allocation[]): PointsLot[] {
  const taken = new Map(allocations.map(a => [a.lotId, a.points] as const));
  return usable
    .filter(lot => taken.has(lot.id))
    .map(lot => ({ ...lot, points: lot.points - taken.get(lot.id)! }));
}

export type Reversal = { restored: PointsLot[]; forfeited: Allocation[] };

/**
 * Give an allocation back to its original lots. A lot that has expired by `at` (the
 * reversal time) or no longer exists forfeits its points; they are not moved elsewhere.
 */
export function reverseAllocations(lots: PointsLot[], allocations: Allocation[], at: Date): Reversal {
  const byId = new Map(lots.map(lot => [lot.id, lot] as const));
  const restored: PointsLot[] = [];
  const forfeited: Allocation[] = [];
  for (const allocation of allocations) {
    const lot = byId.get(allocation.lotId);
    if (lot && !isExpired(lot, at)) restored.push({ ...lot, points: lot.points + allocation.points });
    else forfeited.push(allocation);
  }
  return { restored, forfeited };
}
