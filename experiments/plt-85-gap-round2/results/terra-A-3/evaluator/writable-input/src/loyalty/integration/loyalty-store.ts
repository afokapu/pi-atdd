import { isExpired, type PointsLot } from "../domain/points.ts";

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));
const copy = (l: PointsLot): PointsLot => ({ ...l, expiresAt: new Date(l.expiresAt.getTime()) });

type Allocation = { lotId: string; points: number; expiresAt: Date };
type Redemption = {
  customerId: string;
  orderId: string;
  idempotencyKey: string;
  requestedPoints: number;
  appliedPoints: number;
  /** Aggregate order balance at the time this idempotent request completed. */
  orderAppliedPoints: number;
  allocations: Allocation[];
  reversed: boolean;
};

/** Thrown when an idempotency key is reused for a different request. */
export class IdempotencyConflictError extends Error {}

/**
 * Adapter over the loyalty ledger database (in memory for this service).
 * The redemption operations are serialized, modelling a ledger transaction: an
 * asynchronous caller can never observe and spend the same lot balance twice.
 */
export class InMemoryLoyaltyStore {
  private lots = new Map<string, PointsLot>();
  private redemptions = new Map<string, Redemption>();
  private transactionTail: Promise<void> = Promise.resolve();
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
   * Debit usable lots in expiry order. `maximumOrderPoints` is the complete
   * pre-tax amount of the order, so separate keys cannot overpay one order.
   */
  async redeem(customerId: string, orderId: string, idempotencyKey: string, requestedPoints: number,
    maximumOrderPoints: number, now: Date): Promise<{ appliedPoints: number; orderAppliedPoints: number; currentOrderAppliedPoints: number }> {
    return this.transaction(async () => {
      const key = JSON.stringify([customerId, orderId, idempotencyKey]);
      const prior = this.redemptions.get(key);
      if (prior) {
        if (prior.requestedPoints !== requestedPoints) throw new IdempotencyConflictError("idempotency key was used with a different body");
        return { appliedPoints: prior.appliedPoints, orderAppliedPoints: prior.orderAppliedPoints,
          currentOrderAppliedPoints: this.orderApplied(customerId, orderId) };
      }

      const room = Math.max(0, maximumOrderPoints - this.orderApplied(customerId, orderId));
      let remaining = Math.min(requestedPoints, room);
      const allocations: Allocation[] = [];
      const lots = [...this.lots.values()]
        .filter(l => l.customerId === customerId && !isExpired(l, now) && l.points > 0)
        .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id));
      for (const lot of lots) {
        const spent = Math.min(lot.points, remaining);
        if (spent) {
          lot.points -= spent;
          remaining -= spent;
          allocations.push({ lotId: lot.id, points: spent, expiresAt: new Date(lot.expiresAt.getTime()) });
        }
        if (!remaining) break;
      }
      const appliedPoints = requestedPoints - remaining;
      const orderAppliedPoints = this.orderApplied(customerId, orderId) + appliedPoints;
      this.redemptions.set(key, { customerId, orderId, idempotencyKey, requestedPoints, appliedPoints, orderAppliedPoints, allocations, reversed: false });
      return { appliedPoints, orderAppliedPoints, currentOrderAppliedPoints: orderAppliedPoints };
    });
  }

  /** Return all unreversed redemptions to their source lots if still usable. */
  async reverseOrder(customerId: string, orderId: string, now: Date): Promise<void> {
    await this.transaction(async () => {
      for (const redemption of this.redemptions.values()) {
        if (redemption.customerId !== customerId || redemption.orderId !== orderId || redemption.reversed) continue;
        for (const allocation of redemption.allocations) {
          // Expired points are deliberately not restored on cancellation.
          if (allocation.expiresAt.getTime() <= now.getTime()) continue;
          const lot = this.lots.get(allocation.lotId);
          if (lot) {
            lot.points += allocation.points;
            lot.expiresAt = new Date(allocation.expiresAt.getTime());
          } else {
            this.lots.set(allocation.lotId, { id: allocation.lotId, customerId, points: allocation.points, expiresAt: new Date(allocation.expiresAt.getTime()) });
          }
        }
        redemption.reversed = true;
      }
    });
  }

  private orderApplied(customerId: string, orderId: string): number {
    let total = 0;
    for (const redemption of this.redemptions.values())
      if (redemption.customerId === customerId && redemption.orderId === orderId && !redemption.reversed) total += redemption.appliedPoints;
    return total;
  }

  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const previous = this.transactionTail;
    this.transactionTail = previous.then(() => gate);
    await previous;
    try {
      await io();
      return await operation();
    } finally {
      release();
    }
  }
}
