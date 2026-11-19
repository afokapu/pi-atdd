/**
 * Loyalty domain. Points are held in lots; each lot expires at `expiresAt`
 * (a lot is usable strictly before its expiry instant). 100 points = 1 EUR,
 * and because money is integer cents, one point is worth exactly one cent.
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

/** One planned debit: how many points to take from which lot. */
export type Consumption = { lotId: string; points: number };

/**
 * Decide which lots to debit to spend up to `requested` points: only lots
 * usable at `at` (non-expired, still non-empty), earliest expiry first, so the
 * points the customer would lose soonest are spent first. The sort is stable,
 * so lots with an equal expiry keep their stored order. Plans never take more
 * than is available across the usable lots.
 */
export function planConsumption(
  lots: PointsLot[],
  requested: number,
  at: Date,
): { plan: Consumption[]; consumedPoints: number } {
  const usable = lots
    .filter(l => !isExpired(l, at) && l.points > 0)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const plan: Consumption[] = [];
  let remaining = requested;
  for (const lot of usable) {
    if (remaining <= 0) break;
    const take = Math.min(lot.points, remaining);
    plan.push({ lotId: lot.id, points: take });
    remaining -= take;
  }
  return { plan, consumedPoints: requested - remaining };
}

/**
 * Split a recorded consumption into entries that can still be returned to
 * their original lots right now, and points forfeited because their lot
 * expired in the meantime (or vanished — there is nothing to return those to).
 * Used when a redeemed order is cancelled: refunded points keep the original
 * lot expiry, forfeited points are gone for good.
 */
export function refundableConsumption(
  consumed: readonly Consumption[],
  lotById: ReadonlyMap<string, PointsLot>,
  at: Date,
): { refunds: Consumption[]; forfeitedPoints: number } {
  const refunds: Consumption[] = [];
  let forfeitedPoints = 0;
  for (const entry of consumed) {
    const lot = lotById.get(entry.lotId);
    if (lot && !isExpired(lot, at)) refunds.push(entry);
    else forfeitedPoints += entry.points;
  }
  return { refunds, forfeitedPoints };
}
