import { isExpired, type PointsLot } from "./points.ts";

/** Points taken from (or returned to) a single lot. */
export type Consumption = { lotId: string; points: number };

/** Total spendable points across a customer's lots, ignoring expired ones. */
export function availablePoints(lots: PointsLot[], at: Date): number {
  return lots.reduce((sum, l) => sum + (isExpired(l, at) ? 0 : l.points), 0);
}

/**
 * Plan the consumption of up to `requestedPoints` from a customer's lots:
 * only non-expired lots are used, earliest expiry first (ties keep insertion
 * order). May plan fewer points than requested if the balance is short.
 */
export function planConsumption(lots: PointsLot[], requestedPoints: number, at: Date): Consumption[] {
  const usable = lots
    .filter(l => !isExpired(l, at) && l.points > 0)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const plan: Consumption[] = [];
  let remaining = requestedPoints;
  for (const lot of usable) {
    if (remaining <= 0) break;
    const take = Math.min(lot.points, remaining);
    plan.push({ lotId: lot.id, points: take });
    remaining -= take;
  }
  return plan;
}

/**
 * Plan the refund of points an order consumed: each amount goes back to its
 * original lot unless that lot has expired (or vanished) by `at` — those
 * points are forfeited.
 */
export function planRefund(
  consumed: Consumption[],
  lots: PointsLot[],
  at: Date,
): { refunds: Consumption[]; forfeited: Consumption[] } {
  const byId = new Map(lots.map(l => [l.id, l]));
  const refunds: Consumption[] = [];
  const forfeited: Consumption[] = [];
  for (const c of consumed) {
    const lot = byId.get(c.lotId);
    if (!lot || isExpired(lot, at)) forfeited.push(c);
    else refunds.push(c);
  }
  return { refunds, forfeited };
}
