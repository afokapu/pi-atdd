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

/** Points taken from one lot by a redemption, with the lot's expiry at the time it was taken. */
export type Allocation = { lotId: string; points: number; expiresAt: Date };

export function isExpired(entry: { expiresAt: Date }, at: Date): boolean {
  return entry.expiresAt.getTime() <= at.getTime();
}

/** One point is worth one cent: 100 points = 1 EUR. */
export function pointsValueCents(points: number): number {
  return points;
}

/**
 * Lots that still hold points and are usable at `at`, earliest expiry first. Ties are broken
 * by id so the consumption order is deterministic.
 */
export function usableLots(lots: PointsLot[], at: Date): PointsLot[] {
  return lots
    .filter(l => l.points > 0 && !isExpired(l, at))
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id));
}

/**
 * Take `points` from the usable lots, earliest expiry first. `shortfall` is the part the lots
 * could not cover; whether that is an error is the caller's decision.
 */
export function allocatePoints(lots: PointsLot[], points: number, at: Date): { allocations: Allocation[]; shortfall: number } {
  const allocations: Allocation[] = [];
  let remaining = points;
  for (const lot of usableLots(lots, at)) {
    if (remaining === 0) break;
    const taken = Math.min(lot.points, remaining);
    allocations.push({ lotId: lot.id, points: taken, expiresAt: lot.expiresAt });
    remaining -= taken;
  }
  return { allocations, shortfall: remaining };
}

/**
 * Split recorded allocations at `at`. Points go back only to a lot that is still usable; points
 * whose lot has expired in the meantime are forfeited.
 */
export function splitRestorable(allocations: Allocation[], at: Date): { restorable: Allocation[]; forfeited: Allocation[] } {
  return {
    restorable: allocations.filter(a => !isExpired(a, at)),
    forfeited: allocations.filter(a => isExpired(a, at)),
  };
}
