/**
 * Redemption ledger adapter (in memory for this service).
 *
 * Records every successful redemption: which lots were debited by how much
 * (the basis for restoring points on cancellation) and the exact quote that
 * was returned, so a retried idempotency key can replay the same result.
 * All methods are asynchronous, like the real database client.
 */
import type { LotDeduction } from "../../loyalty/domain/redeem.ts";
import type { QuoteWithPoints } from "../../pricing/domain/quote.ts";

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));

const copy = (r: Redemption): Redemption => ({
  ...r,
  deductions: r.deductions.map(d => ({ ...d })),
  quote: { ...r.quote },
});

/** Ledger entry for one successful redemption of points against an order. */
export type Redemption = {
  idempotencyKey: string;
  orderId: string;
  customerId: string;
  /** What the customer asked to redeem. */
  pointsRequested: number;
  /** What was actually consumed (capped by balance and the amount due). */
  pointsApplied: number;
  /** Which lots were debited by how many points. */
  deductions: LotDeduction[];
  /** The quote returned for the original redemption; replayed verbatim for the same key. */
  quote: QuoteWithPoints;
  /** True once cancellation has restored (or forfeited) this redemption's points. */
  refunded: boolean;
};

export class InMemoryRedemptionStore {
  private byKey = new Map<string, Redemption>();

  async find(idempotencyKey: string): Promise<Redemption | undefined> {
    await io();
    const r = this.byKey.get(idempotencyKey);
    return r && copy(r);
  }

  /** Every redemption ever made against an order (refunded ones included). */
  async allForOrder(orderId: string): Promise<Redemption[]> {
    await io();
    return [...this.byKey.values()].filter(r => r.orderId === orderId).map(copy);
  }

  async save(r: Redemption): Promise<void> {
    await io();
    this.byKey.set(r.idempotencyKey, copy(r));
  }
}
