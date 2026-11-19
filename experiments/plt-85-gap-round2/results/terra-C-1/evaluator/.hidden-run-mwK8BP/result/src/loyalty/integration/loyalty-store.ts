import type { PointsLot } from "../domain/points.ts";

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));
const copy = (l: PointsLot): PointsLot => ({ ...l, expiresAt: new Date(l.expiresAt.getTime()) });

/**
 * Adapter over the loyalty ledger database (in memory for this service).
 * All methods are asynchronous, like the real database client.
 */
export class InMemoryLoyaltyStore {
  private lots = new Map<string, PointsLot>();
  private lotIdsByCustomer = new Map<string, Set<string>>();
  private customerTurns = new Map<string, Promise<void>>();

  constructor(seed: PointsLot[] = []) { for (const l of seed) this.put(l); }

  // This per-customer queue makes the asynchronous read/check/write sequence atomic.
  async withCustomerLock<T>(customerId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.customerTurns.get(customerId) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    this.customerTurns.set(customerId, prior.then(() => turn));
    await prior;
    try { return await operation(); } finally { release(); }
  }

  /** Indexed query for the only lots a redemption may consume, in FIFO-expiry order. */
  async findValidByCustomer(customerId: string, at: Date): Promise<PointsLot[]> {
    await io();
    return [...(this.lotIdsByCustomer.get(customerId) ?? [])]
      .map(id => this.lots.get(id)!)
      .filter(lot => lot.points > 0 && lot.expiresAt.getTime() > at.getTime())
      .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime())
      .map(copy);
  }

  private put(lot: PointsLot): void {
    const existing = this.lots.get(lot.id);
    if (existing && existing.customerId !== lot.customerId) this.lotIdsByCustomer.get(existing.customerId)?.delete(lot.id);
    const ids = this.lotIdsByCustomer.get(lot.customerId) ?? new Set<string>();
    ids.add(lot.id);
    this.lotIdsByCustomer.set(lot.customerId, ids);
    this.lots.set(lot.id, copy(lot));
  }

  /** All lots of a customer (including empty and expired ones), in insertion order. */
  async lotsFor(customerId: string): Promise<PointsLot[]> {
    await io();
    return [...this.lots.values()].filter(l => l.customerId === customerId).map(copy);
  }

  /** Batch lookup keeps cancellation proportional to its recorded allocations. */
  async getLotsByIds(ids: string[]): Promise<PointsLot[]> {
    await io();
    return ids.flatMap(id => {
      const lot = this.lots.get(id);
      return lot ? [copy(lot)] : [];
    });
  }

  async getLot(id: string): Promise<PointsLot | undefined> {
    const lots = await this.getLotsByIds([id]);
    return lots[0];
  }

  /** Insert or replace a lot. */
  async saveLot(lot: PointsLot): Promise<void> {
    await io();
    if (!Number.isInteger(lot.points) || lot.points < 0) throw new RangeError("points must be a non-negative integer");
    this.put(lot);
  }
}
