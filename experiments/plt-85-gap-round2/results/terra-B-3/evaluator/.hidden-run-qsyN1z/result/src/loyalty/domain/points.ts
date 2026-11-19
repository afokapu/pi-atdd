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

export function isExpired(lot: PointsLot, at: Date): boolean {
  return lot.expiresAt.getTime() <= at.getTime();
}

export type PointsConsumption = { lotId: string; points: number; expiresAt: Date };

/**
 * Allocate a request from usable lots in expiry order.  The caller persists the
 * returned allocations atomically, so a redemption can later be reversed to
 * precisely these lots.
 */
export function consumeEarliestLots(lots: PointsLot[], requested: number, at: Date): PointsConsumption[] {
  let remaining = requested;
  const consumed: PointsConsumption[] = [];
  const usableLots = lots.filter(lot => !isExpired(lot, at) && lot.points > 0)
    .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime());
  for (const lot of usableLots) {
    const points = Math.min(lot.points, remaining);
    if (points > 0) {
      lot.points -= points;
      consumed.push({ lotId: lot.id, points, expiresAt: new Date(lot.expiresAt.getTime()) });
      remaining -= points;
    }
    if (remaining === 0) break;
  }
  return consumed;
}
