/** Stored outcome of an idempotent request, scoped by customer and key. */
export type IdempotencyRecord = { fingerprint: string; response: unknown };

const io = () => new Promise<void>(resolve => setTimeout(resolve, 1));

/** Adapter over the idempotency-key table (in memory for this service). */
export class InMemoryIdempotencyStore {
  private records = new Map<string, IdempotencyRecord>();
  private k = (scope: string, key: string) => JSON.stringify([scope, key]);

  async get(scope: string, key: string): Promise<IdempotencyRecord | undefined> {
    await io();
    const r = this.records.get(this.k(scope, key));
    return r && structuredClone(r);
  }

  async put(scope: string, key: string, record: IdempotencyRecord): Promise<void> {
    await io();
    this.records.set(this.k(scope, key), structuredClone(record));
  }
}
