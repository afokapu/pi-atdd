import type { Allocation, PointsLot } from "../domain/points.ts";
import type { RedeemQuote } from "../../pricing/domain/quote.ts";

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));
const copy = (l: PointsLot): PointsLot => ({ ...l, expiresAt: new Date(l.expiresAt.getTime()) });

/**
 * One ledger entry per redemption. `requestFingerprint` identifies the request body that
 * first used `idempotencyKey`, so a replay can be recognised, and `quote` is the result to replay.
 */
export type Redemption = {
  id: string;
  customerId: string;
  orderId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  status: "applied" | "reversed";
  allocations: Allocation[];
  quote: RedeemQuote;
};

const copyRedemption = (r: Redemption): Redemption => structuredClone(r);

/**
 * Adapter over the loyalty ledger database (in memory for this service).
 * All methods are asynchronous, like the real database client, so callers that
 * read and then write must serialise per customer (see loyalty/application/ledger-lock.ts).
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

  /** The redemption that first used this idempotency key for this customer, if any. */
  async redemptionByKey(customerId: string, idempotencyKey: string): Promise<Redemption | undefined> {
    await io();
    const r = [...this.redemptions.values()].find(x => x.customerId === customerId && x.idempotencyKey === idempotencyKey);
    return r && copyRedemption(r);
  }

  /** The redemption on an order that has not been reversed, if any. */
  async activeRedemptionForOrder(orderId: string): Promise<Redemption | undefined> {
    await io();
    const r = [...this.redemptions.values()].find(x => x.orderId === orderId && x.status === "applied");
    return r && copyRedemption(r);
  }

  /** Insert or replace a redemption entry. */
  async saveRedemption(redemption: Redemption): Promise<void> {
    await io();
    this.redemptions.set(redemption.id, copyRedemption(redemption));
  }
}
