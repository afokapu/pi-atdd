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

/** Points taken from one lot. */
export type Consumption = { lotId: string; points: number };

/** 100 points = 1 EUR = 100 cents, so one point is worth exactly one cent. */
export const pointsToCents = (points: number): number => points;

/**
 * Plan which lots pay for up to `points` at instant `at`: only lots not yet expired,
 * earliest expiry first (ties by lot id). Never plans more than asked for or available.
 * The input lots are not modified.
 */
export function allocatePoints(lots: PointsLot[], points: number, at: Date): Consumption[] {
  const usable = lots
    .filter(l => !isExpired(l, at) && l.points > 0)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const plan: Consumption[] = [];
  let left = points;
  for (const lot of usable) {
    if (left <= 0) break;
    const take = Math.min(left, lot.points);
    plan.push({ lotId: lot.id, points: take });
    left -= take;
  }
  return plan;
}
