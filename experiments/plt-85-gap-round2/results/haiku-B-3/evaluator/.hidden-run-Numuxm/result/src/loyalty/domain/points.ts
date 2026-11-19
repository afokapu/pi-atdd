/**
 * Loyalty domain. Points are held in lots; each lot expires at `expiresAt`
 * (a lot is usable strictly before its expiry instant). 100 points = 1 EUR,
 * so one point is exactly one cent and all arithmetic stays in integer cents.
 */
export type PointsLot = {
  id: string;
  customerId: string;
  /** Remaining points in the lot (non-negative integer). */
  points: number;
  expiresAt: Date;
};

/** A slice of one lot spent by a redemption. Kept so a cancellation can return it to the same lot. */
export type Allocation = { lotId: string; points: number; expiresAt: Date };

export const POINTS_PER_EURO = 100;
const CENTS_PER_EURO = 100;

/** Base points earned for an order subtotal (1 point per whole euro). */
export function basePoints(subtotalCents: number): number {
  return Math.floor(subtotalCents / 100);
}

export function isExpired(lot: PointsLot, at: Date): boolean {
  return lot.expiresAt.getTime() <= at.getTime();
}

export function centsForPoints(points: number): number {
  return Math.floor((points * CENTS_PER_EURO) / POINTS_PER_EURO);
}

export function pointsForCents(cents: number): number {
  return (cents * POINTS_PER_EURO) / CENTS_PER_EURO;
}

/**
 * Lots that can still be spent at `at`, earliest expiry first. Ties are broken by
 * lot id so that the same ledger always yields the same allocation.
 */
export function usableLots(lots: PointsLot[], at: Date): PointsLot[] {
  return lots
    .filter(l => !isExpired(l, at) && l.points > 0)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id));
}

export function spendablePoints(lots: PointsLot[], at: Date): number {
  return usableLots(lots, at).reduce((sum, l) => sum + l.points, 0);
}

/**
 * Take exactly `points` from the usable lots, earliest expiry first. Lots that
 * are expired at `at` are never touched. Throws when there are not enough points.
 */
export function spendPoints(lots: PointsLot[], points: number, at: Date): Allocation[] {
  let remaining = points;
  const allocations: Allocation[] = [];
  for (const lot of usableLots(lots, at)) {
    if (remaining === 0) break;
    const take = Math.min(lot.points, remaining);
    allocations.push({ lotId: lot.id, points: take, expiresAt: lot.expiresAt });
    remaining -= take;
  }
  if (remaining > 0) throw new RangeError("not enough usable points");
  return allocations;
}

/**
 * The lot after an allocation is returned to it, with its original expiry.
 * Returns `undefined` when the lot has expired by `at`: those points are forfeited.
 */
export function returnPoints(lot: PointsLot, allocation: Allocation, at: Date): PointsLot | undefined {
  if (isExpired(lot, at)) return undefined;
  return { ...lot, points: lot.points + allocation.points };
}
