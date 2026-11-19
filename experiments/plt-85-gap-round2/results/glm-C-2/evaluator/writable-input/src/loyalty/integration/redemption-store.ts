import type { Allocation } from "../domain/points.ts";
import type { QuoteWithPoints } from "../../pricing/domain/quote.ts";

/** Simulated I/O latency: every call yields to the event loop before touching data. */
const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));

/**
 * One recorded redemption of loyalty points against an order. `scope` +
 * `idempotencyKey` is the unique replay index: the same key under another
 * customer/order scope is a different key, so keys never collide across callers.
 * The original response is stored verbatim so a matching retry replays exactly
 * the first result, and the allocations are stored so a cancel can restore the
 * exact amounts to the exact lots they were drawn from.
 */
export type RedemptionRecord = {
  /** Replay scope, `customerId:orderId`. */
  scope: string;
  idempotencyKey: string;
  /** Fingerprint of the normalised request payload (everything except the key itself). */
  fingerprint: string;
  orderId: string;
  customerId: string;
  /** Points actually consumed — less than requested when the payable amount ran out first. */
  pointsApplied: number;
  /** Which lots were drawn; a reversal restores exactly these amounts to these lots. */
  allocations: Allocation[];
  /** The original result, replayed unchanged for a matching retry. */
  response: { status: number; body: QuoteWithPoints };
  /** Set once when cancelling the order has restored (or forfeited) the allocations. */
  reversed: boolean;
};

/** Composite store key; \u0000 can never appear in a customer or order id. */
const recordKey = (scope: string, idempotencyKey: string): string => scope + "\u0000" + idempotencyKey;

const copy = (r: RedemptionRecord): RedemptionRecord => ({
  ...r,
  allocations: r.allocations.map(a => ({ ...a })),
  response: { ...r.response, body: { ...r.response.body } },
});

/**
 * Adapter over the redemption ledger (in memory for this service), asynchronous
 * like the real database client. `recordIfAbsent` plays the role of the unique
 * constraint that claims an idempotency key inside the use case's critical section.
 */
export class InMemoryRedemptionStore {
  private byKey = new Map<string, RedemptionRecord>();
  /** Secondary index: order id → record keys, so reversal never scans all records. */
  private keysByOrder = new Map<string, Set<string>>();

  /** The recorded redemption for a replay scope, if any. */
  async find(scope: string, idempotencyKey: string): Promise<RedemptionRecord | undefined> {
    await io();
    const r = this.byKey.get(recordKey(scope, idempotencyKey));
    return r && copy(r);
  }

  /** All redemption records of one order (usually zero or one). */
  async forOrder(orderId: string): Promise<RedemptionRecord[]> {
    await io();
    const keys = this.keysByOrder.get(orderId) ?? new Set<string>();
    return [...keys].map(k => copy(this.byKey.get(k)!));
  }

  /** Insert a new record; resolves `false` when the (scope, key) is already claimed. */
  async recordIfAbsent(record: RedemptionRecord): Promise<boolean> {
    await io();
    const key = recordKey(record.scope, record.idempotencyKey);
    if (this.byKey.has(key)) return false;
    this.byKey.set(key, copy(record));
    this.index(record.orderId, key);
    return true;
  }

  /** Insert or replace a record (e.g. marking it reversed after a cancel). */
  async save(record: RedemptionRecord): Promise<void> {
    await io();
    const key = recordKey(record.scope, record.idempotencyKey);
    this.byKey.set(key, copy(record));
    this.index(record.orderId, key);
  }

  private index(orderId: string, key: string): void {
    const keys = this.keysByOrder.get(orderId) ?? new Set<string>();
    keys.add(key);
    this.keysByOrder.set(orderId, keys);
  }
}
