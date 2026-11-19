import { isExpired, type PointsLot } from "./points.ts";

/** Points taken from one lot. */
export type LotConsumption = { lotId: string; points: number };

/**
 * Plan how to take `points` from a customer's lots: only non-expired lots are
 * usable, earliest expiry first (ties keep insertion order). Returns a plan of
 * per-lot consumptions that never exceeds the usable balance.
 */
export function planConsumption(lots: PointsLot[], points: number, now: Date): LotConsumption[] {
  const usable = lots
    .filter(l => l.points > 0 && !isExpired(l, now))
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const plan: LotConsumption[] = [];
  let remaining = points;
  for (const lot of usable) {
    if (remaining <= 0) break;
    const take = Math.min(lot.points, remaining);
    plan.push({ lotId: lot.id, points: take });
    remaining -= take;
  }
  return plan;
}
