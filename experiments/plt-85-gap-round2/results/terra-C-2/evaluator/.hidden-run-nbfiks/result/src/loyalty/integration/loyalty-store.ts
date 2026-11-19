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
  private customerLotIds = new Map<string, Set<string>>();
  private tails = new Map<string, Promise<void>>();

  constructor(seed: PointsLot[] = []) { for (const lot of seed) this.put(lot); }

  /** All lots of a customer (including empty and expired ones), in insertion order. */
  async lotsFor(customerId: string): Promise<PointsLot[]> {
    await io();
    return this.customerLots(customerId);
  }

  /** The indexed subset used by redemption; expiry ordering is part of this boundary. */
  async validLotsFor(customerId: string, at: Date): Promise<PointsLot[]> {
    await io();
    return this.customerLots(customerId)
      .filter(lot => lot.points > 0 && lot.expiresAt.getTime() > at.getTime())
      .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime());
  }

  async getLot(id: string): Promise<PointsLot | undefined> {
    await io();
    const lot = this.lots.get(id);
    return lot && copy(lot);
  }

  /** Fetch allocations in one store call rather than an N+1 restoration loop. */
  async lotsByIds(ids: readonly string[]): Promise<PointsLot[]> {
    await io();
    return ids.flatMap(id => {
      const lot = this.lots.get(id);
      return lot ? [copy(lot)] : [];
    });
  }

  /** Persist only lots changed by a redemption or cancellation. */
  async saveLots(lots: readonly PointsLot[]): Promise<void> {
    await io();
    for (const lot of lots) this.put(lot);
  }

  /** Insert or replace a lot. */
  async saveLot(lot: PointsLot): Promise<void> {
    await io();
    this.put(lot);
  }

  /** Serialises read-check-write work only for one customer's balance. */
  async withCustomerLock<T>(customerId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(customerId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(customerId, tail);
    await previous;
    try { return await operation(); } finally {
      release();
      if (this.tails.get(customerId) === tail) this.tails.delete(customerId);
    }
  }

  private customerLots(customerId: string): PointsLot[] {
    return [...(this.customerLotIds.get(customerId) ?? [])]
      .flatMap(id => this.lots.get(id) ?? [])
      .map(copy);
  }

  private put(lot: PointsLot): void {
    if (!Number.isInteger(lot.points) || lot.points < 0) throw new RangeError("points must be a non-negative integer");
    const old = this.lots.get(lot.id);
    if (old && old.customerId !== lot.customerId) this.customerLotIds.get(old.customerId)?.delete(lot.id);
    if (!this.customerLotIds.has(lot.customerId)) this.customerLotIds.set(lot.customerId, new Set());
    this.customerLotIds.get(lot.customerId)!.add(lot.id);
    this.lots.set(lot.id, copy(lot));
  }
}
