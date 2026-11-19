import type { PointsLot } from "../domain/points.ts";
import type { Redemption } from "../domain/redemption.ts";

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));
const copy = (l: PointsLot): PointsLot => ({ ...l, expiresAt: new Date(l.expiresAt.getTime()) });
const copyRedemption = (r: Redemption): Redemption => ({
  ...r,
  allocations: r.allocations.map(a => ({ ...a, expiresAt: new Date(a.expiresAt.getTime()) })),
  result: { ...r.result },
  ...(r.reversedAt ? { reversedAt: new Date(r.reversedAt.getTime()) } : {}),
});

/**
 * Adapter over the loyalty ledger database (in memory for this service).
 * All methods are asynchronous, like the real database client.
 */
export class InMemoryLoyaltyStore {
  private lots = new Map<string, PointsLot>();
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

  /** The redemption a customer made under this idempotency key, if any. */
  async redemptionByKey(customerId: string, idempotencyKey: string): Promise<Redemption | undefined> {
    await io();
    const r = [...this.redemptions.values()].find(x => x.customerId === customerId && x.idempotencyKey === idempotencyKey);
    return r && copyRedemption(r);
  }

  /** The redemption made against an order, if any. */
  async redemptionForOrder(orderId: string): Promise<Redemption | undefined> {
    await io();
    const r = [...this.redemptions.values()].find(x => x.orderId === orderId);
    return r && copyRedemption(r);
  }

  /**
   * Apply lot updates and a redemption record atomically: everything is validated
   * before anything is written, and nothing is written if validation fails.
   */
  async commit(write: { lots?: PointsLot[]; redemption?: Redemption }): Promise<void> {
    await io();
    const lots = write.lots ?? [];
    for (const l of lots) {
      if (!Number.isInteger(l.points) || l.points < 0) throw new RangeError("points must be a non-negative integer");
    }
    for (const l of lots) this.lots.set(l.id, copy(l));
    if (write.redemption) this.redemptions.set(write.redemption.id, copyRedemption(write.redemption));
  }
}
