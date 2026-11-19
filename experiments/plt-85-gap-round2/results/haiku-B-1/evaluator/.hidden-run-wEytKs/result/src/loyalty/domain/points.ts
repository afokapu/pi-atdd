/**
 * Loyalty domain. Points are held in lots; each lot expires at `expiresAt`
 * (a lot is usable strictly before its expiry instant). 100 points = 1 EUR,
 * so one point is worth exactly one cent.
 */
export type PointsLot = {
  id: string;
  customerId: string;
  /** Remaining points in the lot (non-negative integer). */
  points: number;
  expiresAt: Date;
};

/** Points taken from one lot. `lot` is the lot as it was before the debit. */
export type Debit = { lot: PointsLot; points: number };

/** One lot's share of a redemption. Kept so a cancellation can restore it to the same lot. */
export type Allocation = { lotId: string; points: number; expiresAt: Date };

/**
 * Points redeemed against one order. `result` is what the redeeming call returned;
 * a replay with the same idempotency key returns it unchanged.
 */
export type Redemption<R = unknown> = {
  orderId: string;
  customerId: string;
  idempotencyKey: string;
  /** Identifies the request body. The same key with another fingerprint is a conflict. */
  fingerprint: string;
  allocations: Allocation[];
  status: "held" | "released";
  result: R;
};

export class InsufficientPointsError extends Error {}

/** Base points earned for an order subtotal (1 point per whole euro). */
export function basePoints(subtotalCents: number): number {
  return Math.floor(subtotalCents / 100);
}

export function isExpired(lot: PointsLot, at: Date): boolean {
  return lot.expiresAt.getTime() <= at.getTime();
}

/** Lots still usable at `at`, earliest expiry first: the order in which points are consumed. */
export function usableLots(lots: PointsLot[], at: Date): PointsLot[] {
  return lots
    .filter(l => !isExpired(l, at))
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
}

export function balanceOf(lots: PointsLot[]): number {
  return lots.reduce((sum, l) => sum + l.points, 0);
}

/**
 * Take `points` from the lots in the given order, never more than a lot holds.
 * Throws when the lots cannot cover the amount, so nothing is partially debited.
 */
export function allocatePoints(lots: PointsLot[], points: number): Debit[] {
  if (balanceOf(lots) < points) throw new InsufficientPointsError("insufficient points");
  const debits: Debit[] = [];
  let remaining = points;
  for (const lot of lots) {
    if (remaining === 0) break;
    const take = Math.min(lot.points, remaining);
    if (take > 0) debits.push({ lot, points: take });
    remaining -= take;
  }
  return debits;
}
