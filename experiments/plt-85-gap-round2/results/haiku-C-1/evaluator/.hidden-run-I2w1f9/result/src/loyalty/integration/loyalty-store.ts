import { isExpired, type PointsLot } from "../domain/points.ts";
import type { Redemption } from "../domain/redemption.ts";

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));
const copy = (l: PointsLot): PointsLot => ({ ...l, expiresAt: new Date(l.expiresAt.getTime()) });
const keyOf = (customerId: string, key: string) => customerId + "\u0000" + key;

/**
 * Adapter over the loyalty ledger database (in memory for this service).
 * All methods are asynchronous, like the real database client. Redemptions are indexed by
 * order and by (customer, idempotency key), so lookups never scan the whole ledger.
 */
export class InMemoryLoyaltyStore {
  private lots = new Map<string, PointsLot>();
  private redemptions = new Map<string, Redemption>();   // orderId -> redemption
  private orderByKey = new Map<string, string>();        // customer + key -> orderId
  private locks = new Map<string, Promise<unknown>>();   // customerId -> tail of its queue

  constructor(seed: PointsLot[] = []) { for (const l of seed) this.lots.set(l.id, copy(l)); }

  /** All lots of a customer (including empty and expired ones), in insertion order. */
  async lotsFor(customerId: string): Promise<PointsLot[]> {
    await io();
    return [...this.lots.values()].filter(l => l.customerId === customerId).map(copy);
  }

  /** Only the lots that can still pay at `at`: not expired and with points left. */
  async usableLotsFor(customerId: string, at: Date): Promise<PointsLot[]> {
    await io();
    return [...this.lots.values()]
      .filter(l => l.customerId === customerId && l.points > 0 && !isExpired(l, at))
      .map(copy);
  }

  async getLot(id: string): Promise<PointsLot | undefined> {
    await io();
    const l = this.lots.get(id);
    return l && copy(l);
  }

  /** Lots by id in one call; unknown ids are skipped. */
  async getLots(ids: string[]): Promise<PointsLot[]> {
    await io();
    return ids.flatMap(id => { const l = this.lots.get(id); return l ? [copy(l)] : []; });
  }

  /** Insert or replace a lot. */
  async saveLot(lot: PointsLot): Promise<void> {
    await io();
    if (!Number.isInteger(lot.points) || lot.points < 0) throw new RangeError("points must be a non-negative integer");
    this.lots.set(lot.id, copy(lot));
  }

  async redemptionByKey<Q = unknown>(customerId: string, idempotencyKey: string): Promise<Redemption<Q> | undefined> {
    await io();
    const orderId = this.orderByKey.get(keyOf(customerId, idempotencyKey));
    return orderId === undefined ? undefined : this.copyRedemption<Q>(orderId);
  }

  async redemptionForOrder<Q = unknown>(orderId: string): Promise<Redemption<Q> | undefined> {
    await io();
    return this.copyRedemption<Q>(orderId);
  }

  /** Insert or replace the redemption of an order (replacement is how `reversed` is recorded). */
  async saveRedemption<Q>(redemption: Redemption<Q>): Promise<void> {
    await io();
    this.redemptions.set(redemption.orderId, structuredClone(redemption) as Redemption);
    this.orderByKey.set(keyOf(redemption.customerId, redemption.idempotencyKey), redemption.orderId);
  }

  /**
   * Per-customer async mutex. Each call is chained after the previous one for the same
   * customer, so a read-decide-write in `work` cannot interleave with another one.
   */
  withCustomerLock<T>(customerId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(customerId) ?? Promise.resolve();
    const run = previous.then(work);
    // The queue tail must never reject, or one failed call would block every later one.
    const tail = run.catch(() => undefined);
    this.locks.set(customerId, tail);
    void tail.then(() => { if (this.locks.get(customerId) === tail) this.locks.delete(customerId); });
    return run;
  }

  private copyRedemption<Q>(orderId: string): Redemption<Q> | undefined {
    const r = this.redemptions.get(orderId);
    return r && (structuredClone(r) as Redemption<Q>);
  }
}
