import type { Consumption, PointsLot } from "../domain/points.ts";

/** A recorded answer to a redemption request, replayed for the same idempotency key. */
export type StoredResponse = { fingerprint: string; status: number; body: unknown };

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));
const copy = (l: PointsLot): PointsLot => ({ ...l, expiresAt: new Date(l.expiresAt.getTime()) });

/**
 * Adapter over the loyalty ledger database (in memory for this service).
 * All methods are asynchronous, like the real database client.
 */
export class InMemoryLoyaltyStore {
  private lots = new Map<string, PointsLot>();
  private redemptions = new Map<string, Consumption[]>();
  private responses = new Map<string, StoredResponse>();
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

  /** Points taken from lots to pay for an order, in the order they were taken. */
  async getRedemption(orderId: string): Promise<Consumption[]> {
    await io();
    return (this.redemptions.get(orderId) ?? []).map(c => ({ ...c }));
  }

  async addRedemption(orderId: string, taken: Consumption[]): Promise<void> {
    await io();
    this.redemptions.set(orderId, [...(this.redemptions.get(orderId) ?? []), ...taken.map(c => ({ ...c }))]);
  }

  /** Response recorded for an idempotency key within a scope (e.g. a customer id). */
  async getResponse(scope: string, key: string): Promise<StoredResponse | undefined> {
    await io();
    const r = this.responses.get(scope + "\u0000" + key);
    return r && { ...r };
  }

  async saveResponse(scope: string, key: string, response: StoredResponse): Promise<void> {
    await io();
    this.responses.set(scope + "\u0000" + key, { ...response });
  }

  /** Insert or replace a lot. */
  async saveLot(lot: PointsLot): Promise<void> {
    await io();
    if (!Number.isInteger(lot.points) || lot.points < 0) throw new RangeError("points must be a non-negative integer");
    this.lots.set(lot.id, copy(lot));
  }
}
