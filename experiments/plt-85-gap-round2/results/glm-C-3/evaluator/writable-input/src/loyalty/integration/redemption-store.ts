import type { Redemption } from "../domain/redemption.ts";

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));

/** Scope of an idempotency key: keys are per customer, never global. */
const scopeKey = (customerId: string, idempotencyKey: string): string => customerId + "\u0000" + idempotencyKey;

const copy = (r: Redemption): Redemption => ({
  ...r,
  allocations: r.allocations.map(a => ({ ...a })),
  response: { ...r.response },
});

/**
 * Adapter over the redemption ledger: idempotency records plus the point
 * allocations they captured. All methods are asynchronous, like the real
 * database client. Records are keyed by (customerId, idempotencyKey) and
 * indexed by orderId, so order lookups never scan the whole ledger.
 */
export class InMemoryRedemptionStore {
  private byScope = new Map<string, Redemption>();
  private orderIndex = new Map<string, Set<string>>();

  constructor(seed: Redemption[] = []) {
    for (const r of seed) {
      const key = scopeKey(r.customerId, r.idempotencyKey);
      this.byScope.set(key, copy(r));
      this.index(key, r.orderId);
    }
  }

  private index(key: string, orderId: string): void {
    const keys = this.orderIndex.get(orderId) ?? new Set<string>();
    keys.add(key);
    this.orderIndex.set(orderId, keys);
  }

  /** The record for this customer's key, if that key was already claimed. */
  async findByKey(customerId: string, idempotencyKey: string): Promise<Redemption | undefined> {
    await io();
    const r = this.byScope.get(scopeKey(customerId, idempotencyKey));
    return r && copy(r);
  }

  /** Every redemption recorded for an order (held and reversed), in insertion order. */
  async forOrder(orderId: string): Promise<Redemption[]> {
    await io();
    return [...(this.orderIndex.get(orderId) ?? [])].map(k => copy(this.byScope.get(k)!));
  }

  /**
   * Insert-if-absent per (customerId, idempotencyKey): claims the key inside
   * the side effect's critical section. Returns false when the key is taken.
   */
  async claim(record: Redemption): Promise<boolean> {
    await io();
    const key = scopeKey(record.customerId, record.idempotencyKey);
    if (this.byScope.has(key)) return false;
    this.byScope.set(key, copy(record));
    this.index(key, record.orderId);
    return true;
  }

  /** Replace an existing record (e.g. the status flip held -> reversed). */
  async save(record: Redemption): Promise<void> {
    await io();
    const key = scopeKey(record.customerId, record.idempotencyKey);
    this.byScope.set(key, copy(record));
    this.index(key, record.orderId);
  }
}
