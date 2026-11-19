import { allocate, availablePoints, refund, type LotAllocation, type PointsLot } from "../domain/points.ts";
import type { InMemoryLoyaltyStore } from "../integration/loyalty-store.ts";

/** Write lots one by one; if a write fails, put back the lots already written (best effort). */
async function saveAll(store: InMemoryLoyaltyStore, before: PointsLot[], after: PointsLot[]): Promise<void> {
  const done: PointsLot[] = [];
  try {
    for (const lot of after) { await store.saveLot(lot); done.push(lot); }
  } catch (e) {
    for (const lot of done) {
      const original = before.find(b => b.id === lot.id);
      if (original) await store.saveLot(original).catch(() => undefined);
    }
    throw e;
  }
}

/**
 * Loyalty ledger use cases. Callers must serialise calls per customer
 * (read-modify-write over an asynchronous store).
 */
export class Ledger {
  private store: InMemoryLoyaltyStore;
  constructor(store: InMemoryLoyaltyStore) { this.store = store; }

  async balance(customerId: string, at: Date): Promise<number> {
    return availablePoints(await this.store.lotsFor(customerId), at);
  }

  /** Consume `points` from the customer's lots, earliest expiry first. */
  async spend(customerId: string, points: number, at: Date): Promise<LotAllocation[]> {
    if (points === 0) return [];
    const lots = await this.store.lotsFor(customerId);
    const { allocations, updated } = allocate(lots, points, at);
    await saveAll(this.store, lots, updated);
    return allocations;
  }

  /** Return points to their original lots; points of lots expired at `at` are forfeited. */
  async giveBack(customerId: string, allocations: LotAllocation[], at: Date): Promise<{ returned: number; forfeited: number }> {
    if (allocations.length === 0) return { returned: 0, forfeited: 0 };
    const lots = await this.store.lotsFor(customerId);
    const { updated, forfeited } = refund(new Map(lots.map(l => [l.id, l])), allocations, at);
    await saveAll(this.store, lots, updated);
    const total = allocations.reduce((s, a) => s + a.points, 0);
    return { returned: total - forfeited, forfeited };
  }
}
