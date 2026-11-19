import type { Allocation, PointsLot } from "../domain/points.ts";
import type { PointsQuote } from "../../pricing/domain/quote.ts";

/**
 * A redemption as recorded in the ledger. It keeps the allocations so a cancellation can restore
 * the exact lots, and the original quote so a replay returns the same response.
 */
export type Redemption = {
  customerId: string;
  orderId: string;
  idempotencyKey: string;
  requestedPoints: number;
  allocations: Allocation[];
  reversed: boolean;
  quote: PointsQuote;
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
  /** Keyed by order id: an order carries at most one redemption. */
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

  async redemptionForOrder(orderId: string): Promise<Redemption | undefined> {
    await io();
    const r = this.redemptions.get(orderId);
    return r && structuredClone(r);
  }

  /** Idempotency lookup, scoped to the caller: the same key from another customer is unrelated. */
  async redemptionByKey(customerId: string, idempotencyKey: string): Promise<Redemption | undefined> {
    await io();
    const r = [...this.redemptions.values()].find(x => x.customerId === customerId && x.idempotencyKey === idempotencyKey);
    return r && structuredClone(r);
  }

  async saveRedemption(redemption: Redemption): Promise<void> {
    await io();
    this.redemptions.set(redemption.orderId, structuredClone(redemption));
  }
}
