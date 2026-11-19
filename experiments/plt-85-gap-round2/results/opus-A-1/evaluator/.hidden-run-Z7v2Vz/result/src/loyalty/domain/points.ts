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

/** Points taken from one lot by a redemption. */
export type LotAllocation = { lotId: string; points: number };

/** 100 points = 1 EUR, i.e. one point is worth one cent. */
export const CENTS_PER_POINT = 1;

export class InsufficientPointsError extends Error {}

/** Base points earned for an order subtotal (1 point per whole euro). */
export function basePoints(subtotalCents: number): number {
  return Math.floor(subtotalCents / 100);
}

export function isExpired(lot: PointsLot, at: Date): boolean {
  return lot.expiresAt.getTime() <= at.getTime();
}

/** Points usable at `at`: sum of non-expired lots. */
export function availablePoints(lots: PointsLot[], at: Date): number {
  return lots.filter(l => !isExpired(l, at)).reduce((s, l) => s + l.points, 0);
}

/**
 * Pick `points` from non-expired lots, earliest expiry first (ties: given order).
 * Throws InsufficientPointsError if the usable balance is too small.
 */
export function allocate(lots: PointsLot[], points: number, at: Date): LotAllocation[] {
  if (!Number.isInteger(points) || points < 0) throw new RangeError("points must be a non-negative integer");
  const usable = lots
    .map((lot, i) => ({ lot, i }))
    .filter(({ lot }) => !isExpired(lot, at) && lot.points > 0)
    .sort((a, b) => a.lot.expiresAt.getTime() - b.lot.expiresAt.getTime() || a.i - b.i)
    .map(({ lot }) => lot);
  const out: LotAllocation[] = [];
  let remaining = points;
  for (const lot of usable) {
    if (remaining === 0) break;
    const take = Math.min(lot.points, remaining);
    out.push({ lotId: lot.id, points: take });
    remaining -= take;
  }
  if (remaining > 0) throw new InsufficientPointsError("insufficient points: " + availablePoints(lots, at) + " available, " + points + " needed");
  return out;
}

/** Points worth at most `payableCents`: excess points are not used. */
export function pointsToApply(requestedPoints: number, payableCents: number): number {
  return Math.max(0, Math.min(requestedPoints, Math.floor(payableCents / CENTS_PER_POINT)));
}
