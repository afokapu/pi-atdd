import type { Redemption } from "../domain/redemption.ts";

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));

const copy = (r: Redemption): Redemption => ({
  ...r,
  quote: { ...r.quote },
  lots: r.lots.map(c => ({ ...c })),
  createdAt: new Date(r.createdAt.getTime()),
  ...(r.restoredAt !== undefined ? { restoredAt: new Date(r.restoredAt.getTime()) } : {}),
});

const keyOf = (customerId: string, idempotencyKey: string): string => customerId + "\u0000" + idempotencyKey;

/**
 * Adapter over the redemption ledger database (in memory for this service).
 * All methods are asynchronous, like the real database client.
 */
export class InMemoryRedemptionStore {
  private records = new Map<string, Redemption>();
  private byKey = new Map<string, string>();
  private byOrder = new Map<string, Set<string>>();

  constructor(seed: Redemption[] = []) { for (const r of seed) this.put(r); }

  private put(r: Redemption): void {
    this.records.set(r.id, copy(r));
    this.byKey.set(keyOf(r.customerId, r.idempotencyKey), r.id);
    let ids = this.byOrder.get(r.orderId);
    if (!ids) { ids = new Set(); this.byOrder.set(r.orderId, ids); }
    ids.add(r.id);
  }

  /** The redemption recorded for an idempotency key, if any. */
  async forKey(customerId: string, idempotencyKey: string): Promise<Redemption | undefined> {
    await io();
    const id = this.byKey.get(keyOf(customerId, idempotencyKey));
    const r = id !== undefined ? this.records.get(id) : undefined;
    return r && copy(r);
  }

  /** All redemptions of an order, in insertion order. */
  async forOrder(orderId: string): Promise<Redemption[]> {
    await io();
    return [...(this.byOrder.get(orderId) ?? [])].map(id => copy(this.records.get(id)!));
  }

  /** Insert or replace a redemption. */
  async save(r: Redemption): Promise<void> {
    await io();
    this.put(r);
  }
}
