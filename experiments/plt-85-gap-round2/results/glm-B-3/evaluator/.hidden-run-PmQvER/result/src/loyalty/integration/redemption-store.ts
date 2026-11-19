import type { RedemptionRecord } from "../domain/redemption.ts";

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));

const copyRecord = (r: RedemptionRecord): RedemptionRecord => ({ ...r, consumed: r.consumed.map(c => ({ ...c })) });

/**
 * Adapter over the redemption ledger (in memory for this service): one record
 * per successful redemption, keyed by (customer, idempotencyKey). All methods
 * are asynchronous, like the real database client. Callers must mutate records
 * inside the owner's loyalty ledger transaction (InMemoryLoyaltyStore.transact)
 * so concurrent redemptions for one customer stay consistent.
 */
export class InMemoryRedemptionStore {
  private records = new Map<string, RedemptionRecord>();

  /** Composite key: idempotency keys are unique per customer, not globally. */
  private static key(customerId: string, idempotencyKey: string): string {
    return customerId + "\u0000" + idempotencyKey;
  }

  /** The record this customer previously created with this idempotency key, if any. */
  async find(customerId: string, idempotencyKey: string): Promise<RedemptionRecord | undefined> {
    await io();
    const r = this.records.get(InMemoryRedemptionStore.key(customerId, idempotencyKey));
    return r && copyRecord(r);
  }

  /** Every redemption recorded for an order (an order may be redeemed in several parts). */
  async allForOrder(orderId: string): Promise<RedemptionRecord[]> {
    await io();
    return [...this.records.values()].filter(r => r.orderId === orderId).map(copyRecord);
  }

  /** Insert or replace a redemption record. */
  async save(record: RedemptionRecord): Promise<void> {
    await io();
    this.records.set(InMemoryRedemptionStore.key(record.customerId, record.idempotencyKey), copyRecord(record));
  }

  /** Delete a redemption record; used once its points have been refunded. */
  async remove(customerId: string, idempotencyKey: string): Promise<void> {
    await io();
    this.records.delete(InMemoryRedemptionStore.key(customerId, idempotencyKey));
  }
}
