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

  // A customer ledger is locked for the whole read-modify-write operation.
  // This models the transaction that prevents two HTTP requests spending one lot.
  private customerTails = new Map<string, Promise<void>>();

  async transactCustomer<T>(customerId: string, operation: (lots: PointsLot[]) => T | Promise<T>): Promise<T> {
    const previous = this.customerTails.get(customerId) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    this.customerTails.set(customerId, previous.then(() => turn));
    await previous;
    try {
      await io();
      const lots = [...this.lots.values()].filter(lot => lot.customerId === customerId).map(copy);
      const result = await operation(lots);
      for (const lot of lots) {
        if (!Number.isInteger(lot.points) || lot.points < 0) throw new RangeError("points must be a non-negative integer");
        this.lots.set(lot.id, copy(lot));
      }
      return result;
    } finally {
      release();
    }
  }
}
