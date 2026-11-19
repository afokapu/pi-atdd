import type { ConsumedLot, PointsLot } from "../domain/points.ts";

/** A completed redemption of loyalty points against an order. */
export type Redemption = {
  customerId: string;
  orderId: string;
  /** Client-supplied key; unique per customer. */
  idempotencyKey: string;
  /** Points the client asked for (for replay/conflict detection). */
  pointsRequested: number;
  /** Points actually consumed. */
  pointsRedeemed: number;
  cents: number;
  /** Per-lot consumption, kept so a cancellation can refund the same lots. */
  taken: ConsumedLot[];
  createdAt: Date;
};

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));
const copy = (l: PointsLot): PointsLot => ({ ...l, expiresAt: new Date(l.expiresAt.getTime()) });

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

  // ---- redemption ledger ----

  private static key(customerId: string, idempotencyKey: string): string {
    return customerId + "\u0000" + idempotencyKey;
  }

  private static copyRedemption(r: Redemption): Redemption {
    return { ...r, taken: r.taken.map(t => ({ ...t, expiresAt: new Date(t.expiresAt.getTime()) })), createdAt: new Date(r.createdAt.getTime()) };
  }

  /** Record a completed redemption, keyed by (customer, idempotency key). */
  async saveRedemption(r: Redemption): Promise<void> {
    await io();
    this.redemptions.set(InMemoryLoyaltyStore.key(r.customerId, r.idempotencyKey), InMemoryLoyaltyStore.copyRedemption(r));
  }

  async findRedemption(customerId: string, idempotencyKey: string): Promise<Redemption | undefined> {
    await io();
    const r = this.redemptions.get(InMemoryLoyaltyStore.key(customerId, idempotencyKey));
    return r && InMemoryLoyaltyStore.copyRedemption(r);
  }

  /** All redemptions made against an order, in insertion order. */
  async redemptionsForOrder(orderId: string): Promise<Redemption[]> {
    await io();
    return [...this.redemptions.values()].filter(r => r.orderId === orderId).map(InMemoryLoyaltyStore.copyRedemption);
  }
}
