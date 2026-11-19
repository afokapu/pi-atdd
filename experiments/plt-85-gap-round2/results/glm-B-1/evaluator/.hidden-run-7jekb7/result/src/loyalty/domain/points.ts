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

/** One lot's share of a planned consumption. */
export type PointsAllocation = { lotId: string; points: number };

/** A consumption plan: which lots pay how much, and the points actually applied. */
export type ConsumptionPlan = { allocations: PointsAllocation[]; applied: number };

/**
 * Plan consuming up to `requested` points from a customer's lots. Only
 * non-expired lots are usable, earliest expiry first (ties keep insertion
 * order). The plan never exceeds `capPoints` — 100 points = 1 EUR, so the
 * post-discount amount in cents caps a redemption — nor the points actually
 * available; excess points are simply not consumed. Pure: the caller applies
 * the plan to the ledger store.
 */
export function planConsumption(lots: PointsLot[], requested: number, at: Date, capPoints: number): ConsumptionPlan {
  const usable = lots
    .filter(l => !isExpired(l, at) && l.points > 0)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  let remaining = Math.max(0, Math.min(requested, capPoints));
  let applied = 0;
  const allocations: PointsAllocation[] = [];
  for (const lot of usable) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.points);
    allocations.push({ lotId: lot.id, points: take });
    remaining -= take;
    applied += take;
  }
  return { allocations, applied };
}
