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

/** Points taken from (or returned to) one lot. */
export type LotAllocation = { lotId: string; points: number };

/** 1 point = 1 cent (100 points = 1 EUR). */
export function pointsToCents(points: number): number {
  return points;
}

/** Spendable balance at `at`: sum of non-expired lots. */
export function availablePoints(lots: PointsLot[], at: Date): number {
  return lots.filter(l => !isExpired(l, at)).reduce((s, l) => s + l.points, 0);
}

export class InsufficientPointsError extends Error {}

/**
 * Plan consuming `points` from non-expired lots, earliest expiry first
 * (ties keep the given order). Pure: returns the allocations and updated lots.
 */
export function allocate(lots: PointsLot[], points: number, at: Date): { allocations: LotAllocation[]; updated: PointsLot[] } {
  if (!Number.isInteger(points) || points < 0) throw new RangeError("points must be a non-negative integer");
  const usable = lots
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !isExpired(l, at) && l.points > 0)
    .sort((a, b) => a.l.expiresAt.getTime() - b.l.expiresAt.getTime() || a.i - b.i)
    .map(({ l }) => l);
  if (usable.reduce((s, l) => s + l.points, 0) < points)
    throw new InsufficientPointsError("insufficient points: " + points + " requested");
  const allocations: LotAllocation[] = [];
  const updated: PointsLot[] = [];
  let left = points;
  for (const lot of usable) {
    if (left === 0) break;
    const take = Math.min(left, lot.points);
    allocations.push({ lotId: lot.id, points: take });
    updated.push({ ...lot, points: lot.points - take });
    left -= take;
  }
  return { allocations, updated };
}

/**
 * Plan returning allocations to their original lots. Points whose lot has
 * expired at `at` (or no longer exists) are forfeited.
 */
export function refund(lots: Map<string, PointsLot>, allocations: LotAllocation[], at: Date):
  { updated: PointsLot[]; forfeited: number } {
  const next = new Map<string, PointsLot>();
  let forfeited = 0;
  for (const a of allocations) {
    const lot = next.get(a.lotId) ?? lots.get(a.lotId);
    if (!lot || isExpired(lot, at)) { forfeited += a.points; continue; }
    next.set(lot.id, { ...lot, points: lot.points + a.points });
  }
  return { updated: [...next.values()], forfeited };
}
