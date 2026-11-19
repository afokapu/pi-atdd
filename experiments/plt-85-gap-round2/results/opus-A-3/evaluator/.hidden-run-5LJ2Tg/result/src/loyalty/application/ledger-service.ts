import { isExpired, planConsumption, type LotAllocation } from "../domain/points.ts";
import type { InMemoryLoyaltyStore } from "../integration/loyalty-store.ts";
import { KeyedMutex } from "./keyed-mutex.ts";

export type RestoreResult = { restored: LotAllocation[]; forfeited: LotAllocation[] };

/**
 * Use cases over a customer's points ledger. Every mutation of a customer's lots
 * must run inside `withCustomerLock(customerId, ...)` so that concurrent requests
 * never read the same balance and spend the same points twice.
 */
export class LoyaltyLedger {
  private readonly mutex = new KeyedMutex();
  private readonly store: InMemoryLoyaltyStore;
  private readonly now: () => Date;
  constructor(store: InMemoryLoyaltyStore, now: () => Date) { this.store = store; this.now = now; }

  withCustomerLock<T>(customerId: string, fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(customerId, fn);
  }

  /** Consume `points` from non-expired lots, earliest expiry first. Call under the customer lock. */
  async consume(customerId: string, points: number): Promise<LotAllocation[]> {
    if (points === 0) return [];
    const lots = await this.store.lotsFor(customerId);
    const allocations = planConsumption(lots, points, this.now());
    const byId = new Map(lots.map(l => [l.id, l]));
    const done: LotAllocation[] = [];
    try {
      for (const a of allocations) {
        const lot = byId.get(a.lotId)!;
        await this.store.saveLot({ ...lot, points: lot.points - a.points });
        done.push(a);
      }
    } catch (e) {
      await this.restore(done, { ignoreExpiry: true });
      throw e;
    }
    return allocations;
  }

  /**
   * Return points to the lots they came from, keeping each lot's original expiry.
   * Points whose lot has expired (or no longer exists) are forfeited. Call under the customer lock.
   */
  async restore(allocations: LotAllocation[], opts: { ignoreExpiry?: boolean } = {}): Promise<RestoreResult> {
    const at = this.now();
    const result: RestoreResult = { restored: [], forfeited: [] };
    for (const a of allocations) {
      const lot = await this.store.getLot(a.lotId);
      if (!lot || (!opts.ignoreExpiry && isExpired(lot, at))) { result.forfeited.push(a); continue; }
      await this.store.saveLot({ ...lot, points: lot.points + a.points });
      result.restored.push(a);
    }
    return result;
  }
}
