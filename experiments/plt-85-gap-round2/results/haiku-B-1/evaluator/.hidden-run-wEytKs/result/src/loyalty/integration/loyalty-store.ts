import type { PointsLot, Redemption } from "../domain/points.ts";

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));
const copy = (l: PointsLot): PointsLot => ({ ...l, expiresAt: new Date(l.expiresAt.getTime()) });
const copyRedemption = <R>(r: Redemption<R>): Redemption<R> =>
  ({ ...r, allocations: r.allocations.map(a => ({ ...a, expiresAt: new Date(a.expiresAt.getTime()) })) });

/**
 * Adapter over the loyalty ledger database (in memory for this service).
 * All methods are asynchronous, like the real database client.
 */
export class InMemoryLoyaltyStore {
  private lots = new Map<string, PointsLot>();
  /** Keyed by order id: an order has at most one redemption. */
  private redemptions = new Map<string, Redemption>();
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

  async saveRedemption<R>(redemption: Redemption<R>): Promise<void> {
    await io();
    this.redemptions.set(redemption.orderId, copyRedemption(redemption));
  }

  async redemptionForOrder<R = unknown>(orderId: string): Promise<Redemption<R> | undefined> {
    await io();
    const r = this.redemptions.get(orderId);
    return r && (copyRedemption(r) as Redemption<R>);
  }

  /** Redemption made by a customer under an idempotency key, if any. */
  async redemptionByKey<R = unknown>(customerId: string, key: string): Promise<Redemption<R> | undefined> {
    await io();
    const r = [...this.redemptions.values()].find(x => x.customerId === customerId && x.idempotencyKey === key);
    return r && (copyRedemption(r) as Redemption<R>);
  }
}
