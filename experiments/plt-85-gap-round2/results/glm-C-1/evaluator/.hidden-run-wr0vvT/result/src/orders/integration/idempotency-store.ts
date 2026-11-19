/**
 * Idempotency records for mutating order operations (in memory for this
 * service). Records are keyed by a scope (the order id) plus the
 * client-supplied key, so keys never collide across orders or customers.
 * Each record keeps the fingerprint of the normalised request body and the
 * exact original response, letting a retry be replayed verbatim without
 * repeating side effects.
 */

/** A stored HTTP-shaped outcome, replayed byte-for-byte on retry. */
export type StoredResponse = { status: number; body: unknown };

export type IdempotencyRecord = {
  /** Fingerprint of the normalised body the key was first used with. */
  fingerprint: string;
  response: StoredResponse;
};

export class InMemoryIdempotencyStore {
  private records = new Map<string, IdempotencyRecord>();

  /** Scope + key are joined with a separator that cannot appear in either. */
  private static storageKey(scope: string, idempotencyKey: string): string {
    return scope + "\u0000" + idempotencyKey;
  }

  find(scope: string, idempotencyKey: string): IdempotencyRecord | undefined {
    return this.records.get(InMemoryIdempotencyStore.storageKey(scope, idempotencyKey));
  }

  /** Insert-if-absent: the first record for a (scope, key) pair wins. */
  save(scope: string, idempotencyKey: string, record: IdempotencyRecord): void {
    const k = InMemoryIdempotencyStore.storageKey(scope, idempotencyKey);
    if (!this.records.has(k)) this.records.set(k, record);
  }
}
