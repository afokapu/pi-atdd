/**
 * Loyalty domain. Points are held in lots; each lot expires at `expiresAt`
 * (a lot is usable strictly before its expiry instant). 100 points = 1 EUR,
 * so one point is worth exactly one cent and the conversions below are exact.
 */
export type PointsLot = {
  id: string;
  customerId: string;
  /** Remaining points in the lot (non-negative integer). */
  points: number;
  expiresAt: Date;
};

/** A part of a redemption: how many points were drawn from one lot. */
export type Allocation = { lotId: string; points: number };

export const POINTS_PER_EURO = 100;
const CENTS_PER_EURO = 100;

export class InsufficientPointsError extends Error {}

/** Base points earned for an order subtotal (1 point per whole euro). */
export function basePoints(subtotalCents: number): number {
  return Math.floor(subtotalCents / 100);
}

export function isExpired(lot: PointsLot, at: Date): boolean {
  return lot.expiresAt.getTime() <= at.getTime();
}

export function pointsForCents(cents: number): number {
  return (cents * POINTS_PER_EURO) / CENTS_PER_EURO;
}

export function centsForPoints(points: number): number {
  return (points * CENTS_PER_EURO) / POINTS_PER_EURO;
}

/** Lots that still hold points and have not expired, earliest expiry first (ties by id). */
export function usableLots(lots: PointsLot[], at: Date): PointsLot[] {
  return lots
    .filter(l => l.points > 0 && !isExpired(l, at))
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id));
}

export function availablePoints(lots: PointsLot[], at: Date): number {
  return usableLots(lots, at).reduce((sum, l) => sum + l.points, 0);
}

/**
 * Plan which lots pay for `points`: earliest expiry first, never more than a lot holds.
 * Expired lots are never drawn. Throws if the usable lots cannot cover `points`.
 */
export function allocatePoints(lots: PointsLot[], points: number, at: Date): Allocation[] {
  let remaining = points;
  const plan: Allocation[] = [];
  for (const lot of usableLots(lots, at)) {
    if (remaining === 0) break;
    const take = Math.min(lot.points, remaining);
    plan.push({ lotId: lot.id, points: take });
    remaining -= take;
  }
  if (remaining > 0) throw new InsufficientPointsError(remaining + " points short");
  return plan;
}

export type Restoration = {
  /** Lots whose balance changed (copies; the input is not mutated). */
  changed: PointsLot[];
  restored: Allocation[];
  /** Allocations whose lot had expired by `at`; those points are gone. */
  forfeited: Allocation[];
};

/**
 * Give recorded allocations back to their original lots. A lot is restored
 * only while it is still unexpired at `at`, with its original expiry unchanged.
 */
export function restoreAllocations(lots: PointsLot[], allocations: Allocation[], at: Date): Restoration {
  const byId = new Map(lots.map(l => [l.id, { ...l }]));
  const touched = new Set<string>();
  const restored: Allocation[] = [];
  const forfeited: Allocation[] = [];
  for (const a of allocations) {
    const lot = byId.get(a.lotId);
    if (lot && !isExpired(lot, at)) {
      lot.points += a.points;
      touched.add(lot.id);
      restored.push(a);
    } else {
      forfeited.push(a);
    }
  }
  const changed = [...touched].map(id => byId.get(id)!);
  return { changed, restored, forfeited };
}
