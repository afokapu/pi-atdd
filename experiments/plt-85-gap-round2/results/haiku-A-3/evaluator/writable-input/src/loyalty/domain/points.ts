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

export const POINTS_PER_EURO = 100;
export const CENTS_PER_EURO = 100;

/** Base points earned for an order subtotal (1 point per whole euro). */
export function basePoints(subtotalCents: number): number {
  return Math.floor(subtotalCents / 100);
}

export function isExpired(lot: PointsLot, at: Date): boolean {
  return lot.expiresAt.getTime() <= at.getTime();
}

/** Cents of discount that `points` buy (100 points = 100 cents, so 1 point = 1 cent). */
export function pointsToCents(points: number): number {
  return Math.floor(points * CENTS_PER_EURO / POINTS_PER_EURO);
}

export function centsToPoints(cents: number): number {
  return cents * POINTS_PER_EURO / CENTS_PER_EURO;
}

export class InsufficientPointsError extends Error {}

/** Points a customer can spend at `at`: the sum over lots not yet expired. */
export function spendablePoints(lots: PointsLot[], at: Date): number {
  return lots.filter(l => !isExpired(l, at)).reduce((sum, l) => sum + l.points, 0);
}

/** Points taken from one lot. `expiresAt` is the lot's original expiry. */
export type Allocation = { lotId: string; points: number; expiresAt: Date };

/**
 * Take `points` from non-expired lots, earliest expiry first (stable for equal expiries).
 * Throws InsufficientPointsError if the usable lots hold fewer points.
 */
export function allocatePoints(lots: PointsLot[], points: number, at: Date): Allocation[] {
  if (spendablePoints(lots, at) < points) throw new InsufficientPointsError("not enough spendable points");
  const usable = lots
    .filter(l => !isExpired(l, at) && l.points > 0)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const out: Allocation[] = [];
  let left = points;
  for (const lot of usable) {
    if (left === 0) break;
    const take = Math.min(lot.points, left);
    out.push({ lotId: lot.id, points: take, expiresAt: lot.expiresAt });
    left -= take;
  }
  return out;
}
