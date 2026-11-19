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

/** Points drawn from a single lot, recorded with the redemption for exact reversal. */
export type Allocation = { lotId: string; points: number };

/** Result of planning a consumption: what to draw from which lots. */
export type ConsumptionPlan = { allocations: Allocation[]; totalPoints: number };

/** Result of planning a reversal: what returns where, and what is lost. */
export type RestorationPlan = { restorations: Allocation[]; forfeited: Allocation[] };

/**
 * Points actually consumed for a request. One point is worth one cent
 * (100 points = 1 EUR), so the consumption is capped by the cents the
 * redemption has to cover: the payable amount never drops below zero and
 * surplus points are simply not consumed.
 */
export function consumablePoints(requestedPoints: number, amountDueCents: number): number {
  return Math.min(requestedPoints, amountDueCents);
}

/**
 * Plan consumption of up to `points` from a customer's lots. Only lots that
 * still hold points and are not expired at `at` are usable; they are drawn
 * earliest expiry first so points that would expire soonest are spent first.
 */
export function planConsumption(lots: PointsLot[], points: number, at: Date): ConsumptionPlan {
  const usable = lots
    .filter(l => l.points > 0 && !isExpired(l, at))
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const allocations: Allocation[] = [];
  let remaining = points;
  for (const lot of usable) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.points);
    allocations.push({ lotId: lot.id, points: take });
    remaining -= take;
  }
  return { allocations, totalPoints: points - remaining };
}

/**
 * Plan the reversal of a redemption: every allocation returns to its original
 * lot with the lot's original expiry untouched. Allocations whose lot has
 * expired by `at` are forfeited — they are not restored anywhere.
 */
export function planRestoration(lots: PointsLot[], allocations: Allocation[], at: Date): RestorationPlan {
  const byId = new Map(lots.map(l => [l.id, l]));
  const restorations: Allocation[] = [];
  const forfeited: Allocation[] = [];
  for (const a of allocations) {
    const lot = byId.get(a.lotId);
    if (lot !== undefined && !isExpired(lot, at)) restorations.push(a);
    else forfeited.push(a);
  }
  return { restorations, forfeited };
}
