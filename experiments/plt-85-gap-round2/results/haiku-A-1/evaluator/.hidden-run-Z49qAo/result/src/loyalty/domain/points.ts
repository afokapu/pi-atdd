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

/** 100 points = 1 EUR = 100 cents, so one point is worth one cent. */
export const POINTS_PER_EURO = 100;
const CENTS_PER_EURO = 100;

export function pointsValueCents(points: number): number {
  return (points * CENTS_PER_EURO) / POINTS_PER_EURO;
}

/** Points that can be applied: never more than requested, held, or worth at most the payable amount. */
export function pointsToApply(requested: number, availablePoints: number, payableCents: number): number {
  const payableInPoints = Math.floor((payableCents * POINTS_PER_EURO) / CENTS_PER_EURO);
  return Math.max(0, Math.min(requested, availablePoints, payableInPoints));
}

/** Points held in lots that are still usable at `at`. */
export function usablePoints(lots: PointsLot[], at: Date): number {
  return lots.filter(l => !isExpired(l, at)).reduce((sum, l) => sum + l.points, 0);
}

/** A slice of one lot consumed by a redemption. Keeps the lot's expiry so it can be restored. */
export type Allocation = { lotId: string; points: number; expiresAt: Date };

/** Split `count` points over usable lots, earliest expiry first. Pure; does not mutate the lots. */
export function allocatePoints(lots: PointsLot[], count: number, at: Date): Allocation[] {
  if (count > usablePoints(lots, at)) throw new RangeError("not enough usable points");
  const usable = lots
    .filter(l => l.points > 0 && !isExpired(l, at))
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const out: Allocation[] = [];
  let remaining = count;
  for (const lot of usable) {
    if (remaining === 0) break;
    const take = Math.min(lot.points, remaining);
    out.push({ lotId: lot.id, points: take, expiresAt: new Date(lot.expiresAt.getTime()) });
    remaining -= take;
  }
  return out;
}

/** Lots after spending the allocations. Pure. */
export function spend(lots: PointsLot[], allocations: Allocation[]): PointsLot[] {
  return lots.map(l => {
    const taken = allocations.filter(a => a.lotId === l.id).reduce((s, a) => s + a.points, 0);
    return taken ? { ...l, points: l.points - taken } : l;
  });
}

/**
 * Lots after returning allocations. Points go back to their original lot (same expiry);
 * points whose lot has expired by `at` are forfeited. Pure.
 */
export function restore(lots: PointsLot[], allocations: Allocation[], at: Date): PointsLot[] {
  return lots.map(l => {
    const back = allocations.filter(a => a.lotId === l.id).reduce((s, a) => s + a.points, 0);
    return back && !isExpired(l, at) ? { ...l, points: l.points + back } : l;
  });
}
