/**
 * Loyalty domain. Points are held in lots; each lot expires at `expiresAt`
 * (a lot is usable strictly before its expiry instant). 100 points = 1 EUR.
 * Consumption always draws from non-expired lots, earliest expiry first, so
 * points about to die are spent before points with time left.
 */
export type PointsLot = {
  id: string;
  customerId: string;
  /** Remaining points in the lot (non-negative integer). */
  points: number;
  expiresAt: Date;
};

/** One draw against a single lot, recorded so the exact amounts can be reversed. */
export type Allocation = { lotId: string; points: number };

/** Conversion rate: 100 points = 1 EUR = 100 cents, so 1 point = 1 cent. */
export const CENTS_PER_POINT = 1;

/** Base points earned for an order subtotal (1 point per whole euro). */
export function basePoints(subtotalCents: number): number {
  return Math.floor(subtotalCents / 100);
}

export function isExpired(lot: PointsLot, at: Date): boolean {
  return lot.expiresAt.getTime() <= at.getTime();
}

/**
 * Points actually applied to a payable amount of `amountCents`: capped to the
 * amount (excess points stay in their lots) and never negative.
 */
export function applicablePoints(requestedPoints: number, amountCents: number): number {
  return Math.max(0, Math.min(requestedPoints, Math.floor(amountCents / CENTS_PER_POINT)));
}

/** Lots the customer can still spend at `at`: non-empty and not expired. */
export function spendableLots(lots: PointsLot[], at: Date): PointsLot[] {
  return lots.filter(l => l.points > 0 && !isExpired(l, at));
}

/** Total points the customer can spend at `at` (expired lots are worthless). */
export function spendablePoints(lots: PointsLot[], at: Date): number {
  return spendableLots(lots, at).reduce((sum, l) => sum + l.points, 0);
}

/**
 * Plan drawing exactly `points` points from usable lots, earliest expiry first
 * (lot id breaks ties for determinism). The caller must have checked
 * `spendablePoints >= points`; the returned allocations sum to exactly `points`.
 */
export function planConsumption(lots: PointsLot[], points: number, at: Date): Allocation[] {
  const earliestExpiryFirst = [...spendableLots(lots, at)]
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || (a.id < b.id ? -1 : 1));
  const plan: Allocation[] = [];
  let remaining = points;
  for (const lot of earliestExpiryFirst) {
    if (remaining <= 0) break;
    const take = Math.min(lot.points, remaining);
    plan.push({ lotId: lot.id, points: take });
    remaining -= take;
  }
  return plan;
}

export type Restoration = { restored: Allocation[]; forfeited: Allocation[] };

/**
 * Plan the exact reversal of a consumption: every allocation goes back to its
 * own original lot (keeping that lot's original expiry), unless the lot has
 * expired by `at` — those points are forfeited, never re-issued as a fresh lot.
 */
export function planRestoration(allocations: Allocation[], lots: PointsLot[], at: Date): Restoration {
  const byId = new Map(lots.map(l => [l.id, l]));
  const restored: Allocation[] = [];
  const forfeited: Allocation[] = [];
  for (const a of allocations) {
    const lot = byId.get(a.lotId);
    if (lot && !isExpired(lot, at)) restored.push(a);
    else forfeited.push(a);
  }
  return { restored, forfeited };
}
