/**
 * Loyalty domain. Points are held in lots; each lot expires at `expiresAt`
 * (a lot is usable strictly before its expiry instant). 100 points = 1 EUR,
 * so 1 point = 1 cent: point counts and cent amounts convert 1:1 and that
 * conversion needs no rounding anywhere.
 */
export type PointsLot = {
  id: string;
  customerId: string;
  /** Remaining points in the lot (non-negative integer). */
  points: number;
  expiresAt: Date;
};

/** One draw from a single lot, recorded at consumption time so a reversal can restore exactly these points to exactly this lot. */
export type PointAllocation = { lotId: string; points: number };

/** Base points earned for an order subtotal (1 point per whole euro). */
export function basePoints(subtotalCents: number): number {
  return Math.floor(subtotalCents / 100);
}

export function isExpired(lot: PointsLot, at: Date): boolean {
  return lot.expiresAt.getTime() <= at.getTime();
}

/**
 * Plan the consumption of up to `requested` points from a customer's lots:
 * only lots that have not expired at `at` are usable, drawn earliest expiry
 * first (insertion order breaks ties). Pure: reads lots, never mutates them;
 * the caller persists the returned allocations to the ledger.
 */
export function planConsumption(lots: PointsLot[], requested: number, at: Date): PointAllocation[] {
  const usable = lots
    .filter(l => !isExpired(l, at) && l.points > 0)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const allocations: PointAllocation[] = [];
  let remaining = requested;
  for (const lot of usable) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.points);
    allocations.push({ lotId: lot.id, points: take });
    remaining -= take;
  }
  return allocations;
}

/** Total points across a set of allocations. */
export function allocationTotal(allocations: PointAllocation[]): number {
  return allocations.reduce((sum, a) => sum + a.points, 0);
}

/**
 * Plan the reversal of recorded allocations at time `at`: each draw goes back
 * to its original lot (whose expiry stays untouched) unless that lot has
 * expired by `at` — points of expired lots are forfeited, not restored, and a
 * lot that no longer exists counts as expired. Pure; the caller persists the
 * plan and reports both lists.
 */
export function planReversal(lots: PointsLot[], allocations: PointAllocation[], at: Date): { restored: PointAllocation[]; forfeited: PointAllocation[] } {
  const byId = new Map(lots.map(l => [l.id, l]));
  const restored: PointAllocation[] = [];
  const forfeited: PointAllocation[] = [];
  for (const a of allocations) {
    const lot = byId.get(a.lotId);
    if (lot !== undefined && !isExpired(lot, at)) restored.push(a);
    else forfeited.push(a);
  }
  return { restored, forfeited };
}
