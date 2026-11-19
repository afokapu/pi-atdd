import { isExpired, type PointsLot } from "../domain/points.ts";

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));
const copy = (l: PointsLot): PointsLot => ({ ...l, expiresAt: new Date(l.expiresAt.getTime()) });

type Allocation = { readonly lotId: string; readonly points: number; readonly expiresAt: Date };
type Redemption = {
  readonly orderId: string;
  readonly customerId: string;
  readonly idempotencyKey: string;
  readonly requestedPoints: number;
  readonly appliedPoints: number;
  readonly allocations: Allocation[];
  refunded: boolean;
};

export class IdempotencyConflictError extends Error {}

/**
 * Adapter over the loyalty ledger database (in memory for this service).
 * Customer-scoped serialisation models the transaction used by the real ledger.
 */
export class InMemoryLoyaltyStore {
  private lots = new Map<string, PointsLot>();
  private redemptions = new Map<string, Redemption>();
  private customerLocks = new Map<string, Promise<void>>();

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
   * Consume at most `maximumPoints` from live lots, ordering by imminent expiry.
   * The idempotency record and the lot mutations are one customer transaction.
   */
  async redeem(customerId: string, orderId: string, idempotencyKey: string, requestedPoints: number,
    maximumPoints: number, at: Date): Promise<number> {
    return this.exclusively(customerId, async () => {
      const key = this.redemptionKey(customerId, idempotencyKey);
      const prior = this.redemptions.get(key);
      if (prior) return this.repeatOrReject(prior, orderId, requestedPoints);
      const toConsume = Math.min(requestedPoints, maximumPoints);
      const allocations = this.takeLots(customerId, toConsume, at);
      const appliedPoints = allocations.reduce((total, allocation) => total + allocation.points, 0);
      await io();
      this.redemptions.set(key, { orderId, customerId, idempotencyKey, requestedPoints, appliedPoints, allocations, refunded: false });
      return appliedPoints;
    });
  }

  /** Read a completed request so an already-redeemed order can serve its retry. */
  async redemptionFor(customerId: string, idempotencyKey: string): Promise<{ orderId: string; requestedPoints: number; appliedPoints: number } | undefined> {
    await io();
    const redemption = this.redemptions.get(this.redemptionKey(customerId, idempotencyKey));
    return redemption && { orderId: redemption.orderId, requestedPoints: redemption.requestedPoints, appliedPoints: redemption.appliedPoints };
  }

  /** Return unexpired redeemed points to the exact lots from which they came. */
  async refundOrder(customerId: string, orderId: string, at: Date): Promise<void> {
    await this.exclusively(customerId, async () => {
      const redemptions = [...this.redemptions.values()]
        .filter(redemption => redemption.customerId === customerId && redemption.orderId === orderId && !redemption.refunded);
      for (const redemption of redemptions) this.restoreLiveLots(redemption, at);
      await io();
      for (const redemption of redemptions) redemption.refunded = true;
    });
  }

  private takeLots(customerId: string, wanted: number, at: Date): Allocation[] {
    let remaining = wanted;
    const lots = [...this.lots.values()]
      .filter(lot => lot.customerId === customerId && lot.points > 0 && !isExpired(lot, at))
      .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime() || left.id.localeCompare(right.id));
    const allocations: Allocation[] = [];
    for (const lot of lots) {
      const points = Math.min(lot.points, remaining);
      if (points > 0) allocations.push({ lotId: lot.id, points, expiresAt: new Date(lot.expiresAt.getTime()) });
      lot.points -= points;
      remaining -= points;
      if (remaining === 0) break;
    }
    return allocations;
  }

  private restoreLiveLots(redemption: Redemption, at: Date): void {
    for (const allocation of redemption.allocations) {
      if (allocation.expiresAt.getTime() <= at.getTime()) continue;
      const lot = this.lots.get(allocation.lotId);
      if (lot) {
        lot.points += allocation.points;
        // A returned balance retains the expiry that governed the original spend.
        lot.expiresAt = new Date(allocation.expiresAt.getTime());
      } else this.lots.set(allocation.lotId, { id: allocation.lotId, customerId: redemption.customerId,
        points: allocation.points, expiresAt: new Date(allocation.expiresAt.getTime()) });
    }
  }

  private repeatOrReject(prior: Redemption, orderId: string, requestedPoints: number): number {
    if (prior.orderId !== orderId || prior.requestedPoints !== requestedPoints)
      throw new IdempotencyConflictError("idempotency key was used with a different body");
    return prior.appliedPoints;
  }

  private redemptionKey(customerId: string, idempotencyKey: string): string { return `${customerId}:${idempotencyKey}`; }

  private async exclusively<T>(customerId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.customerLocks.get(customerId);
    let release: () => void = () => undefined;
    const own = new Promise<void>(resolve => { release = resolve; });
    this.customerLocks.set(customerId, own);
    await previous;
    try { return await action(); }
    finally {
      release();
      if (this.customerLocks.get(customerId) === own) this.customerLocks.delete(customerId);
    }
  }
}
