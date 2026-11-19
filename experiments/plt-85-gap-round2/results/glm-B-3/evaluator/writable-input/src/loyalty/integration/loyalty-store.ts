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
  /** Chain of in-flight transactions per customer; serializes ledger mutations. */
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
   * Run `op` as a transaction on one customer's ledger: reads and writes for
   * that customer are serialized, so concurrent redemptions or refunds can
   * never interleave and spend/refund the same points twice. Must not be
   * nested for the same customer (it would wait on its own lock).
   */
  async transact<T>(customerId: string, op: () => Promise<T>): Promise<T> {
    const tail = this.locks.get(customerId) ?? Promise.resolve();
    const run = tail.catch(() => {}).then(op);
    this.locks.set(customerId, run.then(() => undefined, () => undefined));
    return run;
  }
}
