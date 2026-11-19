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
  return isExpiredAt(lot.expiresAt, at);
}

export function isExpiredAt(expiresAt: Date, at: Date): boolean {
  return expiresAt.getTime() <= at.getTime();
}

/** 100 points are worth 1 EUR. */
export const POINTS_PER_EURO = 100;

/** Value of points in integer cents (100 points = 100 cents = 1 EUR). */
export function pointsToCents(points: number): number {
  return Math.floor((points * 100) / POINTS_PER_EURO);
}

/** How many points a cent amount can be paid with. */
export function centsToPoints(cents: number): number {
  return Math.floor((cents * POINTS_PER_EURO) / 100);
}

/** Lots that still have points and are usable at `at`, earliest expiry first. */
export function usableLots(lots: PointsLot[], at: Date): PointsLot[] {
  return lots
    .filter(l => l.points > 0 && !isExpired(l, at))
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
}

/** Points consumed from a single lot, with the lot's expiry kept for refunds. */
export type ConsumedLot = { lotId: string; points: number; expiresAt: Date };

/**
 * Pure plan: consume up to `pointsWanted` from `lots`, earliest expiry first.
 * Never touches expired lots; stops when the lots run out, so at most the
 * available balance is consumed. Returns what was taken and the total.
 */
export function planRedemption(lots: PointsLot[], pointsWanted: number, at: Date): { taken: ConsumedLot[]; points: number } {
  const taken: ConsumedLot[] = [];
  let remaining = pointsWanted;
  for (const lot of usableLots(lots, at)) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.points);
    taken.push({ lotId: lot.id, points: take, expiresAt: new Date(lot.expiresAt.getTime()) });
    remaining -= take;
  }
  return { taken, points: pointsWanted - remaining };
}
