import { isExpired, type PointsLot } from "../domain/points.ts";

export type PointsAllocation = { lotId: string; points: number; expiresAt: Date };
type RedemptionRequest = { orderId: string; idempotencyKey: string; points: number };
type Redemption = RedemptionRequest & { allocations: PointsAllocation[] };
export class IdempotencyConflictError extends Error {}

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));
const copy = (l: PointsLot): PointsLot => ({ ...l, expiresAt: new Date(l.expiresAt.getTime()) });
const copyAllocation = (allocation: PointsAllocation): PointsAllocation => ({
  ...allocation, expiresAt: new Date(allocation.expiresAt.getTime()),
});

/**
 * Adapter over the loyalty ledger database (in memory for this service).
 * All methods are asynchronous, like the real database client.
 */
export class InMemoryLoyaltyStore {
  private lots = new Map<string, PointsLot>();
  private redemptions = new Map<string, Redemption>();
  private customerTails = new Map<string, Promise<void>>();
  constructor(seed: PointsLot[] = []) { for (const l of seed) this.lots.set(l.id, copy(l)); }

  /**
   * Atomically consumes a customer's lots. The callback runs while their ledger
   * is locked, allowing the order's recorded redemptions to stay in step.
   */
  async redeem(
    customerId: string,
    request: RedemptionRequest,
    now: Date,
    maximumPoints: () => number,
    record: (allocations: PointsAllocation[]) => void,
  ): Promise<{ allocations: PointsAllocation[]; replayed: boolean }> {
    return this.exclusively(customerId, async () => {
      await io();
      const recordKey = `${customerId}:${request.idempotencyKey}`;
      const previous = this.redemptions.get(recordKey);
      if (previous) return this.replay(previous, request);

      const wanted = Math.min(request.points, maximumPoints());
      const allocations = this.allocate(customerId, wanted, now);
      this.redemptions.set(recordKey, { ...request, allocations: allocations.map(copyAllocation) });
      record(allocations.map(copyAllocation));
      return { allocations, replayed: false };
    });
  }

  /** Return points only to still-valid lots, preserving their original expiry. */
  async restore(customerId: string, allocations: PointsAllocation[], now: Date): Promise<void> {
    await this.exclusively(customerId, async () => {
      await io();
      for (const allocation of allocations) {
        const lot = this.lots.get(allocation.lotId);
        // Restore the recorded expiry rather than extending a lot during a refund.
        if (lot && lot.customerId === customerId && allocation.expiresAt.getTime() > now.getTime()) {
          lot.expiresAt = new Date(allocation.expiresAt.getTime());
          lot.points += allocation.points;
        }
      }
    });
  }

  private replay(previous: Redemption, request: RedemptionRequest): { allocations: PointsAllocation[]; replayed: boolean } {
    if (previous.orderId !== request.orderId || previous.points !== request.points)
      throw new IdempotencyConflictError("idempotency key was already used with a different request");
    return { allocations: previous.allocations.map(copyAllocation), replayed: true };
  }

  private allocate(customerId: string, wanted: number, now: Date): PointsAllocation[] {
    let remaining = wanted;
    const allocations: PointsAllocation[] = [];
    const lots = [...this.lots.values()]
      .filter(lot => lot.customerId === customerId && lot.points > 0 && !isExpired(lot, now))
      .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime());
    for (const lot of lots) {
      if (remaining === 0) break;
      const points = Math.min(lot.points, remaining);
      lot.points -= points;
      remaining -= points;
      allocations.push({ lotId: lot.id, points, expiresAt: new Date(lot.expiresAt) });
    }
    return allocations;
  }

  private async exclusively<T>(customerId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.customerTails.get(customerId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>(resolve => { release = resolve; });
    const queued = previous.then(() => tail);
    this.customerTails.set(customerId, queued);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (this.customerTails.get(customerId) === queued) this.customerTails.delete(customerId);
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
}
