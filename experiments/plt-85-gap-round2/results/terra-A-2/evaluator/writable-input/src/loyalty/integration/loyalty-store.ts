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
  totalRedeemedPoints: number;
  allocations: Allocation[];
  refunded: boolean;
};

export class IdempotencyConflictError extends Error {}

/**
 * Adapter over the loyalty ledger database (in memory for this service).
 * All methods are asynchronous, like the real database client. Customer-level
 * serialization models the transaction used by the real ledger, so two
 * requests cannot select the same remaining points.
 */
export class InMemoryLoyaltyStore {
  private lots = new Map<string, PointsLot>();
  private redemptions = new Map<string, Redemption>();
  private customerLocks = new Map<string, Promise<void>>();
  constructor(seed: PointsLot[] = []) { for (const l of seed) this.lots.set(l.id, copy(l)); }

  private async exclusive<T>(customerId: string, action: () => T): Promise<T> {
    const previous = this.customerLocks.get(customerId) ?? Promise.resolve();
    let unlock!: () => void;
    const current = new Promise<void>(resolve => { unlock = resolve; });
    this.customerLocks.set(customerId, current);
    await previous;
    try {
      await io();
      return action();
    } finally {
      unlock();
      if (this.customerLocks.get(customerId) === current) this.customerLocks.delete(customerId);
    }
  }

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

  /** Atomically consume up to maxPoints from usable lots, expiring soonest first. */
  async redeem(customerId: string, orderId: string, idempotencyKey: string, requestedPoints: number,
    maxPoints: number, now: Date): Promise<{ appliedPoints: number; totalRedeemedPoints: number }> {
    return this.exclusive(customerId, () => {
      const key = customerId + "\u0000" + idempotencyKey;
      const existing = this.redemptions.get(key);
      if (existing) {
        if (existing.customerId !== customerId || existing.orderId !== orderId || existing.requestedPoints !== requestedPoints)
          throw new IdempotencyConflictError("idempotency key was used with a different request");
        return { appliedPoints: existing.appliedPoints, totalRedeemedPoints: existing.totalRedeemedPoints };
      }

      // maxPoints is the whole order's discounted subtotal, not just this request.
      let remaining = Math.min(requestedPoints, Math.max(0, maxPoints - this.totalForOrder(customerId, orderId)));
      const allocations: Allocation[] = [];
      const eligible = [...this.lots.values()]
        .filter(l => l.customerId === customerId && l.points > 0 && !isExpired(l, now))
        .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id));
      for (const lot of eligible) {
        const points = Math.min(lot.points, remaining);
        if (points === 0) break;
        lot.points -= points;
        remaining -= points;
        allocations.push({ lotId: lot.id, points, expiresAt: new Date(lot.expiresAt.getTime()) });
      }
      const appliedPoints = Math.min(requestedPoints, Math.max(0, maxPoints - this.totalForOrder(customerId, orderId))) - remaining;
      const totalRedeemedPoints = this.totalForOrder(customerId, orderId) + appliedPoints;
      this.redemptions.set(key, { customerId, orderId, idempotencyKey, requestedPoints, appliedPoints,
        totalRedeemedPoints, allocations, refunded: false });
      return { appliedPoints, totalRedeemedPoints };
    });
  }

  /** Return unexpired allocations from cancelled orders to their original lots. */
  async refundOrder(customerId: string, orderId: string, now: Date): Promise<void> {
    await this.exclusive(customerId, () => {
      for (const redemption of this.redemptions.values()) {
        if (redemption.customerId !== customerId || redemption.orderId !== orderId || redemption.refunded) continue;
        for (const allocation of redemption.allocations) {
          // The recorded expiry prevents a replacement lot from extending a refund's life.
          if (allocation.expiresAt.getTime() <= now.getTime()) continue;
          const lot = this.lots.get(allocation.lotId);
          if (lot) lot.points += allocation.points;
        }
        redemption.refunded = true;
      }
    });
  }

  private totalForOrder(customerId: string, orderId: string): number {
    let total = 0;
    for (const r of this.redemptions.values())
      if (r.customerId === customerId && r.orderId === orderId && !r.refunded) total += r.appliedPoints;
    return total;
  }
}
