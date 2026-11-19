import { isExpired, type PointsLot } from "../domain/points.ts";

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));
const copy = (l: PointsLot): PointsLot => ({ ...l, expiresAt: new Date(l.expiresAt.getTime()) });

/**
 * Adapter over the loyalty ledger database (in memory for this service).
 * All methods are asynchronous, like the real database client.
 */
export class InMemoryLoyaltyStore {
  private lots = new Map<string, PointsLot>();
  private customerQueues = new Map<string, Promise<void>>();
  constructor(seed: PointsLot[] = []) { for (const l of seed) this.lots.set(l.id, copy(l)); }

  /** All lots of a customer (including empty and expired ones), in insertion order. */
  async lotsFor(customerId: string): Promise<PointsLot[]> {
    await io();
    return [...this.lots.values()].filter(l => l.customerId === customerId).map(copy);
  }

  /** Ledger query used for redemption; its production equivalent is indexed by customer and expiry. */
  async findAvailableByCustomer(customerId: string, at: Date): Promise<PointsLot[]> {
    await io();
    return [...this.lots.values()]
      .filter(lot => lot.customerId === customerId && lot.points > 0 && !isExpired(lot, at))
      .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime() || left.id.localeCompare(right.id))
      .map(copy);
  }

  async getLot(id: string): Promise<PointsLot | undefined> {
    await io();
    const l = this.lots.get(id);
    return l && copy(l);
  }

  /** Batch lookup avoids one asynchronous round trip for every recorded allocation. */
  async getLotsByIds(ids: string[]): Promise<PointsLot[]> {
    await io();
    return ids.flatMap(id => {
      const lot = this.lots.get(id);
      return lot ? [copy(lot)] : [];
    });
  }

  /** Insert or replace a lot. */
  async saveLot(lot: PointsLot): Promise<void> {
    await io();
    if (!Number.isInteger(lot.points) || lot.points < 0) throw new RangeError("points must be a non-negative integer");
    this.lots.set(lot.id, copy(lot));
  }

  /** Persist only lots changed by a debit or reversal. */
  async saveLots(lots: PointsLot[]): Promise<void> {
    await io();
    for (const lot of lots) {
      if (!Number.isInteger(lot.points) || lot.points < 0) throw new RangeError("points must be a non-negative integer");
      this.lots.set(lot.id, copy(lot));
    }
  }

  /** Serialize debit and reversal work for one customer without blocking other customers. */
  async withCustomerLock<T>(customerId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.customerQueues.get(customerId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.customerQueues.set(customerId, current);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.customerQueues.get(customerId) === current) this.customerQueues.delete(customerId);
    }
  }
}
