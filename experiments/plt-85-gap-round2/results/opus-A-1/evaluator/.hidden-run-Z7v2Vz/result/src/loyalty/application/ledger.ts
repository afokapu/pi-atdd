import type { LotAllocation, PointsLot } from "../domain/points.ts";
import { isExpired } from "../domain/points.ts";
import type { InMemoryLoyaltyStore } from "../integration/loyalty-store.ts";

/**
 * Write lots one by one; if a write fails, put back the lots already written
 * (best effort) so a failed request does not leave a half-applied ledger change.
 */
async function writeAll(store: InMemoryLoyaltyStore, before: PointsLot[], after: PointsLot[]): Promise<void> {
  const written: PointsLot[] = [];
  try {
    for (let i = 0; i < after.length; i++) { await store.saveLot(after[i]!); written.push(before[i]!); }
  } catch (e) {
    for (const lot of written.reverse()) { try { await store.saveLot(lot); } catch { /* keep original error */ } }
    throw e;
  }
}

/** Take the allocated points out of their lots. Caller must hold the customer lock. */
export async function debit(store: InMemoryLoyaltyStore, lots: PointsLot[], allocations: LotAllocation[]): Promise<void> {
  const byId = new Map(lots.map(l => [l.id, l]));
  const before = allocations.map(a => byId.get(a.lotId)!);
  const after = before.map((lot, i) => ({ ...lot, points: lot.points - allocations[i]!.points }));
  await writeAll(store, before, after);
}

/**
 * Return redeemed points to their original lots (original expiry kept). Points whose
 * lot has expired at `at` (or no longer exists) are forfeited. Caller must hold the lock.
 */
export async function credit(store: InMemoryLoyaltyStore, allocations: LotAllocation[], at: Date):
  Promise<{ returnedPoints: number; forfeitedPoints: number }> {
  const before: PointsLot[] = [], after: PointsLot[] = [];
  let returnedPoints = 0, forfeitedPoints = 0;
  for (const a of allocations) {
    const lot = await store.getLot(a.lotId);
    if (!lot || isExpired(lot, at)) { forfeitedPoints += a.points; continue; }
    const prev = after.find(l => l.id === lot.id);
    if (prev) prev.points += a.points;
    else { before.push(lot); after.push({ ...lot, points: lot.points + a.points }); }
    returnedPoints += a.points;
  }
  await writeAll(store, before, after);
  return { returnedPoints, forfeitedPoints };
}
