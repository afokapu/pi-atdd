/**
 * Loyalty domain. Points are held in lots; each lot expires at `expiresAt`
 * (a lot is usable strictly before its expiry instant). 100 points = 1 EUR.
 */
export type PointsLot = {
  id: string;
  customerId: string;
  /** Remaining points in the lot (non-negative integer). */
  points: number;
  expiresAt: Date;
};

/** Base points earned for an order subtotal (1 point per whole euro). */
export function basePoints(subtotalCents: number): number {
  return Math.floor(subtotalCents / 100);
}

/** Points taken from one lot by a redemption. The lot's expiry is copied so a later cancel can judge it. */
export type PointsAllocation = { lotId: string; points: number; expiresAt: Date };

export function isExpired(lot: Pick<PointsLot, "expiresAt">, at: Date): boolean {
  return lot.expiresAt.getTime() <= at.getTime();
}

/**
 * Spend up to `points` from the lots still usable at `at`, earliest expiry first.
 * Ties keep the store's order (the sort is stable). Lots that are empty or expired
 * are skipped; points beyond what is available are simply not allocated.
 */
export function allocatePoints(lots: PointsLot[], points: number, at: Date): PointsAllocation[] {
  const usable = lots
    .filter(l => l.points > 0 && !isExpired(l, at))
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const allocations: PointsAllocation[] = [];
  let remaining = points;
  for (const lot of usable) {
    if (remaining === 0) break;
    const take = Math.min(remaining, lot.points);
    allocations.push({ lotId: lot.id, points: take, expiresAt: lot.expiresAt });
    remaining -= take;
  }
  return allocations;
}

/**
 * Allocations that can be given back at `at`. A lot whose expiry has passed by then
 * forfeits its points, so those allocations are dropped.
 */
export function restorable(allocations: PointsAllocation[], at: Date): PointsAllocation[] {
  return allocations.filter(a => !isExpired(a, at));
}
