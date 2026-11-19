/**
 * Loyalty domain: planning the movement of points between lots.
 *
 * Pure functions only — the caller (application layer) applies the returned
 * plan to the asynchronous ledger store. Keeping the decision here makes the
 * expiry-first consumption order and the forfeiture rule unit-testable
 * without any storage.
 */
import { isExpired, type PointsLot } from "./points.ts";

/** A debit (or restoration) of `points` against one specific lot. */
export type LotDeduction = { lotId: string; points: number };

export type SpendPlan = {
  deductions: LotDeduction[];
  /** Total spendable points across the given lots (non-expired, positive balance). */
  available: number;
  /** Points actually consumed: capped by the requested amount and the balance. */
  applied: number;
};

/**
 * Plan consuming up to `requestedPoints` from `lots`. Only non-expired lots
 * are spendable, and they are consumed strictly earliest-expiry-first (equal
 * instants keep insertion order). Excess beyond the request or the balance is
 * simply not consumed.
 */
export function planSpend(lots: PointsLot[], requestedPoints: number, now: Date): SpendPlan {
  const spendable = lots
    .filter(l => l.points > 0 && !isExpired(l, now))
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const available = spendable.reduce((sum, l) => sum + l.points, 0);
  let remaining = Math.min(requestedPoints, available);
  const deductions: LotDeduction[] = [];
  for (const lot of spendable) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.points);
    deductions.push({ lotId: lot.id, points: take });
    remaining -= take;
  }
  return { deductions, available, applied: Math.min(requestedPoints, available) };
}

export type RefundPlan = {
  /** Points restored into their original lots, keeping the lot's original expiry. */
  restorations: LotDeduction[];
  /** Points whose lot has expired (or is gone) at `now` — forfeited, not restored. */
  forfeited: number;
};

/**
 * Plan restoring previously deducted points after a cancellation. Points go
 * back to the exact lot they came from; if that lot has expired in the
 * meantime they are forfeited. `lotById` is a synchronous lookup over lots the
 * caller has already loaded, so this stays a pure decision.
 */
export function planRefund(
  deductions: LotDeduction[],
  lotById: (id: string) => PointsLot | undefined,
  now: Date,
): RefundPlan {
  const restorations: LotDeduction[] = [];
  let forfeited = 0;
  for (const d of deductions) {
    const lot = lotById(d.lotId);
    if (lot && !isExpired(lot, now)) restorations.push({ lotId: d.lotId, points: d.points });
    else forfeited += d.points;
  }
  return { restorations, forfeited };
}
