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
  /** Tail promise per customer: chains that customer's critical sections. */
  private locks = new Map<string, Promise<unknown>>();
  constructor(seed: PointsLot[] = []) { for (const l of seed) this.lots.set(l.id, copy(l)); }

  /** All lots of a customer (including empty and expired ones), in insertion order. */
  async lotsFor(customerId: string): Promise<PointsLot[]> {
    await io();
    return [...this.lots.values()].filter(l => l.customerId === customerId).map(copy);
  }

  async getLot(id: string): Promise<PointsLot | undefined> {
    await io();
    const l = this.lots.get(id);
    return l && copy(l);
  }

  /** Insert or replace a lot. */
  async saveLot(lot: PointsLot): Promise<void> {
    await io();
    if (!Number.isInteger(lot.points) || lot.points < 0) throw new RangeError("points must be a non-negative integer");
    this.lots.set(lot.id, copy(lot));
  }

  /**
   * Run `fn` as one critical section for this customer. Concurrent callers for
   * the same customer are serialised, so a read-decide-write cycle over their
   * lots (e.g. a redemption) can never interleave with another and spend the
   * same points twice; callers for different customers proceed independently.
   * All ledger reads and writes of one operation must happen inside a single
   * `runExclusive` block.
   */
  runExclusive<T>(customerId: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.locks.get(customerId) ?? Promise.resolve();
    // A failed section must not block the next one, hence the `fn, fn` pair.
    const result = tail.then(fn, fn);
    this.locks.set(customerId, result.then(() => undefined, () => undefined));
    return result;
  }
}
