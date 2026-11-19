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

export class InsufficientPointsError extends Error {}

/** 100 points = 1 EUR = 100 cents, i.e. one point is worth one cent. */
export const CENTS_PER_POINT = 1;
export const pointsToCents = (points: number): number => points * CENTS_PER_POINT;
/** Whole points needed to cover at most `cents` (never more than the amount). */
export const centsToPoints = (cents: number): number => Math.floor(cents / CENTS_PER_POINT);

/** Base points earned for an order subtotal (1 point per whole euro). */
export function basePoints(subtotalCents: number): number {
  return Math.floor(subtotalCents / 100);
}

export function isExpired(lot: PointsLot, at: Date): boolean {
  return lot.expiresAt.getTime() <= at.getTime();
}

/** Points usable at `at` across lots (non-expired only). */
export function availablePoints(lots: PointsLot[], at: Date): number {
  return lots.filter(l => !isExpired(l, at)).reduce((s, l) => s + l.points, 0);
}

/**
 * Plan consumption of `points` from non-expired lots, earliest expiry first
 * (ties broken by lot id for determinism). Throws if not enough points.
 */
export function planConsumption(lots: PointsLot[], points: number, at: Date): LotAllocation[] {
  if (!Number.isInteger(points) || points < 0) throw new RangeError("points must be a non-negative integer");
  const usable = lots
    .filter(l => !isExpired(l, at) && l.points > 0)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const allocations: LotAllocation[] = [];
  let remaining = points;
  for (const lot of usable) {
    if (remaining === 0) break;
    const take = Math.min(lot.points, remaining);
    allocations.push({ lotId: lot.id, points: take });
    remaining -= take;
  }
  if (remaining > 0) throw new InsufficientPointsError("insufficient points: requested " + points + ", available " + availablePoints(lots, at));
  return allocations;
}
